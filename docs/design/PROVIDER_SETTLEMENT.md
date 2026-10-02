# Provider 分成与月度账单（Skill 销售 + MCP/A2A 购买与调用）

> 日期：2026-09-28（分成部分）／2026-10-01（月度账单与退款部分）／2026-10-02（MCP/A2A 购买分成与资产归属）
> 相关：`USER_MARKETPLACE.md`、`PROVIDER_SUBMIT_GATE.md`、`LITELLM_BUDGET_SYNC.md`、`AGENT_INSTALL.md`、migration `0008_provider_statements`、`0009_settlement_constraints`、`0013_mcp_a2a_entitlements`、`0014_provider_earnings_asset_attribution`

三类收入共用同一张 `provider_earnings` 表与同一套 70/30 比例。

| 来源 | 触发时机 | 关联字段 |
|---|---|---|
| **Skill 付费购买** | 钱包扣款 + `skill_entitlements` 写入成功后 | `skill_id` + `entitlement_id` |
| **MCP / A2A 一次性购买** | 钱包扣款 + `mcp_server_entitlements` / `a2a_agent_entitlements` 写入成功后 | `asset_type` + `asset_id` + `entitlement_id` |
| **MCP / A2A 调用** | 网关消费结算（`settleGatewaySpend`）落账本时 | `gateway_record_id` → `gateway_spend_records.id` + `asset_type` + `asset_id` |

### 资产归属：`asset_type` + `asset_id`

`skill_id` 只指向 `skills`，所以 MCP/A2A 的收入行原本无处记录"这笔钱是哪个资产的"——创作者账单能显示"你赚了 X"，但回答不了"从什么赚的"。`asset_type` + `asset_id` 这一对可空列补上这个归属。

**为什么不是 `mcp_server_id` / `a2a_agent_id` 两个带 FK 的列**：`provider_earnings` 已经跨多个 schema 模块引用 `skills` / `gateway_spend_records` / `provider_statements`，再加两个指向 `registry-schema` 的 FK 会形成循环（`registry-schema` 已经 import `mcp-schema` 的 `skills`）。`gateway_spend_records` 用的也是 `asset_type` + `asset_name` 这一对，资金表内保持同一套约定。

三条 CHECK 约束（`0014`）：

| 约束 | 保证 |
|---|---|
| `provider_earnings_asset_type_check` | `asset_type` 只能是 `mcp` / `a2a` |
| `provider_earnings_asset_pair_check` | `asset_type` 与 `asset_id` 同有同无 |
| `provider_earnings_single_source_check` | `skill_id` 与 `asset_id` 不能同时有值 |

半截归属（只有 `asset_type` 没有 `asset_id`）比完全没有归属更难排查：按资产聚合时那行被静默漏掉，按类型聚合时又算得进去，两个数字对不上却找不到差在哪。两条来源列同时有值则让账单无法决定按哪个维度聚合，甚至可能被重复计入。

**不回填历史数据**：平台未上线，0014 之前不存在 MCP/A2A 购买路径，没有需要修复的历史行。

### `gateway_spend_records.asset_id`

账本上已有 `asset_name`，但名字可改：`server_name` 改一次，历史账本行就再也对不上资产本身。`asset_id` 记的是资产表主键，分成行从它取值，所以「这个 MCP 一共赚了多少」在改名之后仍然成立。

**不建 FK**：资产被硬删除时账本行不能跟着消失——账本和财务凭证的生命周期长于资产，`author_id` 上的 `ON DELETE SET NULL` 是同样的取舍。

## 分成规则

| 项 | 值 |
|---|---|
| Provider 分成 | **70%**（`PROVIDER_REVENUE_SHARE = 0.7`） |
| 平台抽成 | **30%** |
| 触发时机 | Skill / MCP / A2A 购买成功 / 网关消费结算 |

Skill 路径调用 `creditProviderEarning`，分成失败**不回滚买家授权**（记日志）。
MCP/A2A 购买路径调用 `creditAssetPurchaseEarning`，同样在事务提交之后、失败只记日志——买家已经付了钱也拿到了授权，因为记账失败再去扣他的授权或退他的钱，比少一条收入行伤害大得多。代价是提供方会少一笔收入，所以失败日志必须可用于补账。
网关路径在 `settleGatewaySpend` 内由 `creditGatewayEarnings` 记账，`gateway_record_id` 唯一 → 一次消费只分成一次，重跑结算安全。

三个写入方的幂等键各不相同：Skill 与 MCP/A2A 购买按 `entitlement_id` 去重，网关按 `gateway_record_id` 去重。语义一致——**一笔授权 / 一条账本只分成一次**。

### 幂等约束是**部分**唯一索引

`provider_earnings_entitlement_sale_unique` 建在 `entitlement_id` 上，但带 `WHERE kind = 'sale'`：

```sql
CREATE UNIQUE INDEX provider_earnings_entitlement_sale_unique
    ON provider_earnings (entitlement_id) WHERE kind = 'sale';
```

**不能**建成普通唯一索引。`clawback` 行会从被冲回的销售行复制 `entitlement_id`，所以同一个 `entitlement_id` 合法地出现两次（一条 `sale` + 一条 `clawback`）。普通唯一索引会让退款冲回行永远插不进去——买家退了钱、创作者的负数行却写不进账单，看起来像平台吞了这笔退款。

入账语句的 `ON CONFLICT` 必须带上同样的谓词，Postgres 才能推断出仲裁索引：

```ts
.onConflictDoNothing({
  target: providerEarnings.entitlementId,
  where: sql`${providerEarnings.kind} = 'sale'`,
})
```

对不上的后果不是"退化成普通插入"，而是整条 INSERT 报 `42P10`（`there is no unique or exclusion constraint matching the ON CONFLICT specification`）。而入账发生在购买事务**提交之后**、异常又被吞掉，于是买家付了钱、授权也发了，唯独创作者一行收入都没有——静默的收入损失比抛错更难发现。

**货币口径**：与钱包一致，`CNY` 裸数值，OpenMCP ↔ LiteLLM 不做换算（见 [LITELLM_BUDGET_SYNC.md §1](./LITELLM_BUDGET_SYNC.md)）。

**精度限制**：`provider_earnings` 金额字段是 `decimal(10,2)`，两位小数。极小额的网关调用分成会被舍入为 0 —— 这是表精度决定的，不影响账本（`gateway_spend_records.spend` 是 8 位小数）。

## 出账与打款：月度账单

创作者不再自助提现，改为按月结算。三条不变量，缺一条就会变成"钱付了两次"或者"钱少付了"：

1. **一人一期一单。** `provider_statements(author_id, period, currency)` 唯一，cron 重跑只会跳过已存在的账单。
2. **收入行只能属于一张账单。** 出账时把当月所有未归属的行一次性挂上，跑第二遍结果不变。
3. **打款幂等。** `markStatementPaid` 用条件更新 + 事务内 `returning()` 判定，只有真正完成流转的那一次才写 `paidAt` / 凭证号。

### 日历（全部按 UTC）

`period` 是**实际产生收入的月份**，所有节点都在它的**次月**：

| 节点 | 日期 | 例（`period = 2026-03`） |
|---|---|---|
| 出账 | 次月 5 日 | 2026-04-05 |
| 确认截止（含当日） | 次月 19 日 | 2026-04-19 |
| 逾期自动确认 | 次月 19 日 | cron |
| 打款 | 次月 20 日 | 2026-04-20 |

次月是刻意的：账单结算的是 `period` 本身。若在 `period` 当月 5 日出账，收入还没发生完，账单会永远偏一个月，且一生成就已过确认截止而被立刻自动确认。

### 负账单与缺口滚转

`settlement < 0` 的月份落 `status = 'rolled'`，**不确认也不打款**（数据库 CHECK 强制 `rolled ⇒ payable_amount = 0`），缺口滚入下期 `carryover_amount`。

滚转只读**最近一期**账单，而非"最近一张 `rolled`"。缺口一旦被某期抵扣完，那期就不再是 `rolled`，后面各期自然读到 0 —— 同一笔欠款不会被扣两次。

### 多币种

按 `(author_id, period, currency)` 独立出账，**禁止跨币种求和**。判重时必须带上 `currency`：只按 `(author_id, period)` 判会让已有 CNY 账单的作者跳过当月美元账单，钱直接消失且不报错。

### 收款账号快照

出账时把 `payout_channel` / `payout_account` 快照进账单，而不是打款时再读 profile。否则创作者在 5 日到 20 日之间换绑账号，钱会打到新账号，与账单和银行流水都对不上。

缺账号**不阻止出账**：账单照常生成，账号留空，后台打款清单显示"待补账号"。拒绝对应作者建单会让他的钱卡在未归属状态。

### 与旧 `provider_payout_requests` 的关系

`requestPayout` 已停用（抛错并指向账单页）。停用原因是双付：月度出账扫的是 `statement_id IS NULL` 且 `status = 'payable'` 的行，而旧路径打款时会把行翻成 `paid` 却不动 `statement_id`，同一笔钱能被付两次。

`provider_payout_requests` 表保留，`listPayoutRequests` / `updatePayoutRequest` 继续可用，让财务把存量提现单处理完。存量 `paid` 提现对应的收入行不会再进账单 —— 出账的 `status = 'payable'` 过滤就是为此。

## 退款

退款走**平台余额**（钱包是站内唯一可退渠道；原支付渠道退款需要各自的商户 API 与资质），并撤销买家权益。三种资产（skill / MCP / A2A）的授权表字段结构一致，共用同一段 `refundEntitlement({ kind })`，不写三份副本——钱包口径、`FOR_UPDATE` 闸门、clawback 比例计算在任何一处改动都必须同时作用于三者。

三步在**一个事务**里，顺序不能换：

1. `SELECT ... FOR UPDATE` 锁住 entitlement，并要求 `status = 'active'`
2. 权益置 `revoked`，金额退回买家余额
3. 写一条 `kind = 'clawback'` 的负收入行，`reverses_earning_id` 指回原销售行

`FOR UPDATE` 后的 `status = 'active'` 是唯一的重复退款闸门：两个并发请求都能读到 `active`，只有锁让第二个等待并看到已变成 `revoked` 的结果。否则退两次钱、冲两次分成。

**不删原销售行**：账单按月聚合 `provider_earnings`，删掉会让创作者当月账单凭空少一笔，看起来像平台吞了钱。补一条负数行后 `sale` 与 `clawback` 同时在账单里，两边都能对上账。

**部分退款**按退款比例冲回（全额退款得到完全相反的一行）。`skill_entitlements.refunded_amount <= amount` 由数据库 CHECK 强制 —— 否则下一次退款会算出负数余额，给买家反向扣款。

**退款原因必填**：创作者在账单里看到的负数行只有这一句解释。`refunded_by` 记录执行人，直到 P4 通用审计日志上线，这是退款的最小审计凭据。

### 退款后台的跨类型列表

运营在同一个页面切换 skill / MCP / A2A，所以 `adminListRefundableEntitlements` 要合并三张授权表。这里有两处必须写对，否则页面"看起来能跑"但结果是错的：

**过滤条件逐类构造。** 三张表字段结构一致，最容易写成"构造一次 `where` 喂给三类查询"——而那张 `where` 里的 `skill_entitlements.status` / `skills.title` 并不在 MCP/A2A 那条 SQL 的 FROM 里。每一条跨类型查询都会报 missing FROM-clause，整页退款后台对 MCP/A2A 完全不可用；只选 `kind: 'skill'` 时恰好正常，掩盖了这个 bug。默认 `status = 'active'` 恒成立，所以**每一次**默认列表请求都会炸。

**分页必须发生在合并排序之后。** "各类各取 `limit` 条再合并排序 `slice`"第一页碰巧对，第二页起就错：第一页挤掉的行不会再出现，各类 offset 之后捞到的行里混着本该留在第一页的更早数据，运营翻页会漏行。正确做法是每类多取 `offset + limit` 条，合并后按 `createdAt` 倒序切出全局窗口——全局窗口内的任一行，在它自己那一类里必然排在前 `offset + limit` 名内，所以这样取不会漏。

**复购**：撤销后授权表保留原行（三张表各有唯一键，如 `skill_entitlements (user_id, skill_id)`、`mcp_server_entitlements (user_id, mcp_server_id)`、`a2a_agent_entitlements (user_id, a2a_agent_id)`，一人一资产只有一条），再次购买复用该行并清除退款状态。因此重新购买会拿到新的 `order_id`，但 `entitlementId` 不变 —— 而 `provider_earnings.entitlement_id` 是分成幂等键，所以复购**不会**产生第二条收入行，这是符合预期的：一笔授权只分成一次。

**三种资产共用同一段退款实现**（`refundEntitlement({ kind })`）：三张授权表的字段结构一致，所以钱包口径、`FOR UPDATE` 闸门、clawback 比例计算在任何一处改动都必须同时作用于三者。clawback 行会从原销售行复制 `skill_id` 或 `asset_type`/`asset_id`——丢掉归属会让创作者在账单里看到一笔没有出处的负数。

**MCP/A2A 的 clawback 可能没有对应收入行**：按次付费的调用分成走账本（`gateway_record_id`），没有授权行；这种情况下退款入口不存在，也就没有 clawback。反过来，MCP/A2A 一次性购买**必定**有 `entitlement_id` 对应的销售行，所以 `clawbackSkipped` 对它应当恒为 false——如果为 true，说明入账环节失败了，需要按日志补账。

## 数据表

### `provider_earnings`

- `gross_amount` / `platform_fee` / `net_amount`
- `status`: `pending` | `payable` | `paid`（`paid` = 已通过某条路径打款）
- `statement_id` → `provider_statements.id`，出账时挂上
- `kind`: `sale` | `clawback`；`clawback` 必须为负且必须有 `reverses_earning_id`
- 关联 `author_id`
- **Skill 销售**：`skill_id`（非空）+ 可选 `entitlement_id`
- **MCP/A2A 一次性购买**：`asset_type` + `asset_id`（非空）+ `entitlement_id`
- **网关调用**：`skill_id` 为 null，`gateway_record_id` 非空且唯一；`asset_type` + `asset_id` 在能解析出资产时写入，解析不出时留空
- 索引 `provider_earnings_asset_idx (asset_type, asset_id)` 支撑「这个资产一共赚了多少」

### `provider_statements`

- `period`（`YYYY-MM`，实际收入月）、`currency`
- `gross_amount` / `platform_fee` / `net_amount` / `carryover_amount`（≤ 0）/ `settlement` / `payable_amount`
- `status`: `pending` | `confirmed` | `paid` | `rolled`
- `confirmed_at` / `confirmed_by` / `paid_at` / `paid_by` / `payout_reference`
- `payout_channel` / `payout_account`：出账时快照

### `gateway_spend_records`

网关消费账本，`provider_earnings.gateway_record_id` 指向它。

- `request_id` **唯一** —— 消费扣款的幂等键
- `spend` / `overspend_amount`（余额扣到 0 后的溢出额，不写负余额）/ `total_tokens`
- `asset_type` + `asset_name` + `asset_id` + `author_id`：Provider 归属
- `asset_id` 记的是资产表主键而不是名字。名字可改：`server_name` 改一次，历史账本行就再也对不上资产本身。分成行从 `asset_id` 取值，所以「这个 MCP 一共赚了多少」在改名之后仍然成立
- `asset_id` **不建 FK**：资产被硬删除时账本行不能跟着消失——账本和财务凭证的生命周期长于资产，`author_id` 上的 `ON DELETE SET NULL` 是同样的取舍
- `occurred_at`（消费发生时间）用于按区间重算报表

### `provider_payout_requests`（存量，勿新建）

- `status`: `pending` | `approved` | `rejected` | `paid`
- 快照 `payout_channel` / `payout_account`

### `skill_entitlements`（退款相关字段）

- `status`: `active` | `revoked`；`revoked` 必须有 `revoked_at`
- `revoked_at` / `revocation_reason`
- `refunded_amount` / `refunded_at` / `refunded_by`

## Provider API（tRPC `providers.*`）

| 过程 | 说明 |
|---|---|
| `listMyEarnings` | 分成明细 + 可提现/已付汇总 |
| `listMyStatements` | 本人月度账单 + 每期应付合计 |
| `confirmStatement` | 确认本人账单（19 日截止前） |
| `listMyPayoutRequests` | 历史提现记录（存量） |

## Admin API（tRPC `admin.providers.*`）

| 过程 | 说明 |
|---|---|
| `listStatements` | 按状态 / 月份筛选账单 |
| `listPayableStatements` | 待打款清单（含到期标记） |
| `getStatementDetail` | 单张账单明细：聚合了哪些收入行 |
| `confirmStatement` | 代确认兜底（cron 挂了的当天解开阻塞） |
| `markStatementPaid` | 回填凭证号 → `paid`（幂等） |
| `listRefundableEntitlements` | 可退款订单列表（搜索邮箱 / Skill / 订单号） |
| `refundEntitlement` | 退款（原因必填，`amount` 缺省全额） |
| `unbilledEarnings` | 上一期出账日之后仍未归属的收入 |
| `listPayoutRequests` / `updatePayoutRequest` | **存量**提现单处理 |

## UI

- Provider：`/dashboard/earnings` — 月度账单、确认截止倒计时、收款账户快照
- Admin：`/admin/provider-payouts` — 待打款清单（含账单明细展开、代确认、凭证号回填）+ 订单退款

## 迁移

```bash
pnpm --filter @workspace/db db:push        # 从 Drizzle schema 建 DDL
# 0008_provider_statements.sql        — provider_statements + earnings/entitlement 字段
# 0009_settlement_constraints.sql     — 9 个 CHECK 约束 + refunded_by
# 0013_mcp_a2a_entitlements.sql       — mcp_server_entitlements / a2a_agent_entitlements
# 0014_provider_earnings_asset_attribution.sql — earnings + 账本的 asset_type/asset_id
```

⚠️ **`db:push` 只读 Drizzle schema，完全忽略 `.sql` 文件**。约束写在 SQL 里而没写进 `mcp-schema.ts`，push 时会被静默丢弃 —— 本项目曾因此出现 9 个 CHECK 全部缺失、正数 `clawback` 能写进库的情况。**约束必须声明在 schema 里**，0009 / 0014 只是给已 push 过的库补历史缺口。

`drizzle/__drizzle_migrations` 里只有 3 条记录而仓库有 9 个 SQL：0003/0004/0006/0007 为手写且无 snapshot，**不要直接运行 `db:generate`**（会从最后一个 snapshot 重新推导，试图重复应用已存在的列）。

## 定时任务

网关调用分成依赖结算任务。**OpenMCP 不部署在 Vercel 上**，因此没有 `vercel.json` 的 crons；
任务由 `src/lib/cron/local-cron.ts` 在 Next.js 进程内调度（`instrumentation.ts` 启动时拉起）。

| 任务 | 默认频率 | 作用 |
|---|---|---|
| `gateway-settlement` | 5 分钟 | 扣余额 → 回推 `max_budget` → 记分成 → 重算日报表 |
| `gateway-budget-sync` | 1 小时 | 给所有网关用户重算并下发 `max_budget`（自愈漂移） |
| `provider-statements` | 1 小时 | 出账（过了 5 日）+ 逾期自动确认（过了 19 日） |

每个任务有独立 `enabled` 门控：未配置 LiteLLM 不会阻断纯 DB 的账单任务。

覆盖全部环境变量（均为可选）：

```bash
ENABLE_LOCAL_CRON=0                        # 关闭定时任务（默认开启）
GATEWAY_SETTLEMENT_INTERVAL_SEC=300        # 结算间隔，下限 30
GATEWAY_SETTLEMENT_DAYS=1                  # 结算回看天数
GATEWAY_BUDGET_SYNC_INTERVAL_SEC=3600      # 预算自愈间隔，下限 60
GATEWAY_BUDGET_SYNC_LIMIT=200              # 每轮处理的用户数上限
PROVIDER_STATEMENTS_INTERVAL_SEC=3600      # 账单任务间隔，下限 60
```

人工补数据 / 排障仍可走 HTTP 端点（`CRON_SECRET` 未配置时仅开发环境可用）：

```
GET /api/cron/provider-statements?force=true            # 强制跑出账 + 自动确认
GET /api/cron/provider-statements?period=2026-01        # 补指定月份（自动跳过日期门槛）
GET /api/cron/provider-usage?days=30                    # 回填历史网关收入
GET /api/cron/budget-sync?userId=<id>                   # 单用户预算自愈
```

两个性质需要知道：
- **多副本各跑一份**，靠唯一约束保证不重复扣款/出账，只是浪费 API 调用。
- **重启丢一次执行**，靠下一轮回看窗口覆盖，不影响正确性。

## 测试

```bash
cd apps/web && npx vitest run
```

- `src/test/provider-statements.test.ts` — 纯日历逻辑（跨年、非法 period、确认截止）
- `src/test/settlement-integration.test.ts` — **打真实 PostgreSQL**：`FOR UPDATE` 并发幂等、
  `numeric` 余额运算、事务原子性、CHECK 约束真的拦得住、缺口滚转不被扣两次

`vitest.config.ts` 把 `@workspace/db` 别名到 `src` 而非 `dist`：package.json 让 Node 优先解析
`dist/index.mjs`，而该构建产物可能落后于 schema 源码（tsconfig `paths` 指向 `src`，所以 typecheck 全绿但运行时拿到旧表定义）。