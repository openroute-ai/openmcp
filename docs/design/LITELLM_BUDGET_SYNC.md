# 网关预算桥：OpenMCP 余额 → LiteLLM `max_budget`

> 版本：v1.0（2026-09-28）
> 范围：`apps/openmcp` · 充值入账后的网关预算同步、余额不足拦截、存量 Key 回补
> 关联：[API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)、[PROVIDER_SETTLEMENT.md](./PROVIDER_SETTLEMENT.md)、[USER_MARKETPLACE.md](./USER_MARKETPLACE.md)

---

## 0. 本次要解决的问题

上一轮审计结论：资金链断在充值之后。

| 环节 | 修复前状态 |
|---|---|
| 充值入账 `balances` | ✅ 支付宝 / 微信回调直接加余额 |
| 同步到 LiteLLM | ❌ `recharge.updateUserBudget` 只有一行 `console.info`，全仓无调用方 |
| Key 预算 | ❌ `/key/generate` 不传 `max_budget`，所有网关 Key 无限额 |
| 余额不足拦截 | ❌ 无 |

后果：**用户在 OpenMCP 有余额，但网关调用不受任何约束**；反过来 LiteLLM 侧的花费也从不回写 OpenMCP，用户余额与真实消耗完全脱钩。

本文档只解决**最致命的一段**：把余额变成网关侧真实生效的硬上限，并在余额耗尽时于调用发生前被拒绝。

---

## 1. 货币语义：数值直传，不做换算

> **规则：OpenMCP 与 LiteLLM 之间不做任何货币语义转换。**

- OpenMCP 侧唯一金额真相是 `balances.amountTotal`（`currency = 'CNY'`，`numeric(16,8)`）。
- LiteLLM 侧 `max_budget` / `spend` / `provider_daily_usage.spend` 一律视为**无单位的裸数值**；其内部按美元计价的语义**被有意忽略**。
- 同步时直接把 `Number(balances.amountTotal)` 写进 `max_budget`，不查汇率、不乘系数、不做 `currency` 字段映射。
- 因此「充值 100 元」= 网关预算 100 个数值单位。这是一次**有意的口径统一**，不是 bug。

**为什么不换算**：本平台的 MCP / A2A 资产由 Provider 自主定价，定价本身就用 OpenMCP 钱包的同一套数字。若在网关侧再叠一层 FX，等于对同一笔钱做两次折算，且会让账单无法自洽。代价是 LiteLLM 报表里的绝对金额与真实美元支出不可比——这属于 LiteLLM 侧的**报表口径**问题，不影响 OpenMCP 的应收应付。

代码锚点：`src/lib/litellm/budget-sync.ts`（`readAvailableBalanceCNY` 的注释同此规则）。

---

## 2. 核心公式

LiteLLM 的 `max_budget` 是**累计上限**：请求放行的条件是 `key.spend < key.max_budget`，且 `spend` 只增不减（未设 `budget_duration` 时不重置）。

OpenMCP 的 `amountTotal` 是**当前可用余额**：充值 `+`，Skill 购买 `-`。

两者口径不同，直接令 `max_budget = amountTotal` 会让「已花掉的钱」被重复扣一次。因此：

```
max_budget = openmcp_available_balance + litellm_key_spend
```

于是网关侧剩余额度恒等于：

```
max_budget - key.spend  ==  openmcp_available_balance
```

**不变量：`LiteLLM 侧该 Key 的剩余预算 ≡ OpenMCP 侧该用户的可用余额`。**

这个公式的三个好处：

1. **幂等**：任意时刻重算都得到同一个正确结果，重复同步无害。
2. **免增量记账**：不需要维护「上次同步到多少」的游标，也不需要 offset 累加。
3. **自愈**：只要每次同步都重读两侧真实值，网关漏同步、超支、误同步都能在下次同步时收敛。

> LiteLLM 的 `spend` 从 `GET /key/list?user_id=…` 读取（返回体按 `key_alias` 索引），不依赖明文 Key。

### 2.1 余额为 0 时不写 `max_budget = 0`

不同 LiteLLM 版本对 `max_budget = 0` 的解释不一致（部分版本当作「无限制」）。因此余额耗尽时**额外下发 `blocked: true`**，用显式封禁而不是靠 `0` 的边界语义：

| 场景 | 下发内容 |
|---|---|
| `available > 0` | `max_budget = available + keySpend`，`blocked: false` |
| `available <= 0` | `blocked: true`（不依赖 `max_budget` 边界语义） |

`/key/update` 同时接受 `max_budget` 与 `blocked`，一次调用即可双向切换。

### 2.2 读不到 `keySpend` 时宁可不发

`keySpend` 来自 `GET /key/list`，该调用失败时必须与「读到空列表」区分处理：

- 退回 `api_keys.metadata.gatewayBudget.keySpend`（上次同步时落库的值）；
- 两者都没有才盲写一次；
- 已有本地记录则**跳过并标记失败**，留给下一次触发。

理由：若在不知道 `keySpend` 的情况下下发 `max_budget = available`，等于抹掉那段已消费额度，用户会被**多授权**一截 —— 这比「这次不同步」更糟。方向上宁可欠同步（拦得偏严），不可超发。

---

## 3. 触发点

| # | 触发 | 位置 | 说明 |
|---|---|---|---|
| T1 | 充值支付成功 | `provider/alipay.ts` `checkPaymentStatus` / `handleWebhook`；`provider/wechat.ts` 同名方法 | 余额增加后立即同步 |
| T2 | 充值状态轮询发现已完成 | `payment/recharge/router.ts` `checkPaymentStatus` | 覆盖「用户没等 webhook」的情况 |
| T3 | 手动同步 | `recharge.updateUserBudget` | 原空壳接口改为真实实现，供客户端与人工兜底调用 |
| T4 | Skill 付费购买成功 | `web/skills/purchase.ts` | 余额减少后下拉预算（保持不变量） |
| T5 | 签发新 Key | `server/routers/web/apiKeys.ts` `createApiKey` | `/key/generate` 直接带上 `max_budget`，新 Key 从诞生起就有上限 |
| T6 | 定时自愈（每小时） | `lib/litellm/local-cron.ts` `gateway-budget-sync` | 进程内调度，给所有网关用户重算并下发 `max_budget` |
| T7 | 用户主动点击「同步」 | `apiKeys.syncGatewayBudget` | 面板上的手动修复入口 |
| T8 | 存量回补 / 人工排障 | `GET|POST /api/cron/budget-sync` | 给上线前签发、预算为空的存量 Key 补上限 |

**同步失败不回滚充值。** 余额是本地事务内的事实，预算只是网关侧的镜像；失败时记日志 + 发 `litellmBudgetUpdateFailed` 通知邮件，由 T3 / T6 / T7 兜底重试。宁可短暂超发，也不让已收钱的订单回滚。

---

## 4. 调用前拦截发生在哪里

市场 MCP / A2A 的调用**不经过 OpenMCP**，请求直达 LiteLLM。因此 OpenMCP 无法在请求路径上做拦截，拦截点必须落在 LiteLLM：

```
Agent ──► {GATEWAY}/{name}/mcp   ──► LiteLLM 鉴权
                                        │
                                        ├─ blocked == true ────────► 拒绝（余额耗尽）
                                        ├─ spend >= max_budget ────► 拒绝（预算用尽）
                                        └─ 通过 ──► 转发到 Provider 端点
```

这也是为什么「拦截」必须依赖 `max_budget` + `blocked` 在 LiteLLM 侧真实生效，而不能只在 OpenMCP 侧记一个余额判断。

OpenMCP 侧仍然提供**前置提示**，避免用户把请求打出去才吃拒：

- `apiKeys.getGatewayBudgetStatus` 返回 `{ available, keys, blocked }`；
- `/dashboard/apikeys` 在可用余额为 0 时展示告警条与「去充值」入口；
- 余额为 0 时签发新 Key 也会被标记为 blocked（用户充值后由 T1 解除）。

---

## 5. 数据流

```
充值支付成功
   │
   ├─► balances.amount / amountTotal  (本地事务)
   │
   └─► syncUserGatewayBudget(userId)          src/lib/litellm/budget-sync.ts
            │
            ├─ 读 balances.amountTotal               → available
            ├─ 读本地 apiKeys(provider=litellm)      → keyAlias 列表
            ├─ 读 LiteLLM GET /key/list?user_id      → 每 alias 的 spend
            │
            └─ 对每个 alias: POST /key/update
                  { key_alias, max_budget: available + spend, blocked: available <= 0 }
```

按 `key_alias`（而非明文 Key）寻址，因为本地只存 `sha256`，无法还原明文。LiteLLM `/key/update`、`/key/block` 均支持 `key_alias` 定位。

---

## 6. 阶段二：消费回写与结算（v2.0）

v1.0 只做了「余额 → 预算」的单向同步。审计发现：**MCP/A2A 消费从不回写 `balances`**，`amountTotal` 与真实消费之间的缺口只会单向扩大，`max_budget` 因此追的是一个不断漂移的锚点。

阶段二按依赖顺序补齐四步，后一步依赖前一步。

### 6.0 依赖关系

```
S1 消费回写（幂等扣款）  ← 没有它，max_budget 守的是假锚点
      ↓
S2 扣款后回推 max_budget  ← 余额降了预算不降，用户仍能超花
      ↓
S3 共享池分配             ← N 把 Key 的额度之和不得超过一份 amountTotal
      ↓
S4 Provider 分成入账     ← 依赖 S1 已确定归属的 authorId + spend
```

---

### S1 · 消费回写（按 `request_id` 幂等扣款）

**新增表 `gateway_spend_records`**：LiteLLM 消费日志的本地账本，唯一键 `request_id`。

| 字段 | 用途 |
|---|---|
| `request_id` (unique) | 幂等键。重复同步同一条日志不会二次扣款 |
| `user_id` | 消费用户（由 `keyAlias` 反查本地 `api_keys`） |
| `key_alias` / `api_key_id` | 归属哪把 Key |
| `spend` | 扣款金额（数值直传，不换算） |
| `asset_type` / `asset_name` | 命中的 `mcp_servers` / `a2a_agents` 资产 |
| `author_id` | Provider 归属，S4 用 |
| `occurred_at` | 消费发生时间（`startTime`），与入库时间区分 |

**扣款**：事务内 `UPDATE balances SET amount = amount - spend, amount_total = amount_total - spend, amount_spend = amount_spend + spend`，**同事务**插入 `gateway_spend_records`。顺序很重要——先插记录（唯一约束挡住重复），再扣款。

**余额不足时不留负数**：LiteLLM 侧 `max_budget` 是滞后的，扣款时可能已透支。扣到 0 为止，溢出部分记入 `overspendAmount` 字段留待人工/后续对账，**不写成负余额**。负余额会让「充值加回来」这条恢复路径变得难以推理。

**归属解析**：`/spend/logs` 返回 `api_key`（明文），本地存的是 `sha256`，因此按 `sha256(api_key)` 反查 `api_keys.key` 得到 `user_id`。查不到的日志（已删除的 Key、非本平台 Key）跳过并计数，不阻塞整批。

---

### S2 · 扣款后回推 `max_budget`

S1 每扣一次款，立刻调 `syncUserGatewayBudget(userId)` 把新的 `amountTotal` 推给网关。

这里有个必须讲清的相互作用：v1.0 的公式是 `max_budget = available + keySpend`。S1 之后 `keySpend` 增长而 `available` 等量减少，两者在**时间上错开**（LiteLLM 先记 spend，我们后扣款），所以同步必须在扣款**之后**做，否则会把还没扣的余额又发出去一次。

幂等性不受影响：S1 有 `request_id` 唯一约束保证只扣一次，S2 只读取当前余额重新计算，重复执行结果一致。

---

### S3 · 共享池分配（多 Key）

v1.0 的 L1 问题：`max_budget = available + keySpend` 让每把 Key 都拿到一份完整余额。用户持 2 把 Key 时理论可花 2 倍。

**做法**：不再每把 Key 都给 `available`，而是把 `available` 作为**用户级单一池**按各 Key 的 `spend` 占比分配：

```
userSpend = Σ keySpend_i
share_i    = userSpend > 0 ? available * keySpend_i / userSpend : available
maxBudget_i = keySpend_i + share_i
```

不变量变为：`Σ (maxBudget_i - keySpend_i) == available`，即**所有 Key 的剩余额度之和恰好等于余额**。

`userSpend == 0`（全新用户、还没调过）时退化为「单 Key 独得全部余额」——此时用户只有一把 Key 是正常的；多把全新 Key 并存时按 alias 字典序轮流独享（按序取整），避免 N 把都拿到全额。

`share_i` 是小数，LiteLLM 的 `max_budget` 接受浮点；分配时保留 6 位小数，舍入误差在池内吸收（最后一把 Key 吃掉余数），保证求和精确。

---

### S4 · Provider 分成入账

`provider_earnings` 当前 `skill_id` 是 `notNull()` 且有外键，MCP/A2A 没有 Skill，无法直接复用。

**做法**：S1 的 `gateway_spend_records` 已带 `author_id` 与 `spend`，S4 复用同一份记录，按 `PROVIDER_REVENUE_SHARE = 0.7` 写 `provider_earnings`：

- `skill_id` 改为可空，外键保持 `onDelete: cascade`（不再级联删除网关类记录）
- 新增 `gateway_record_id` 唯一列，保证「一次消费只分成一次」
- `currency` 用 `CNY`（与 `balances` 一致，数值直传不换算）

同时把 `provider_daily_usage` 从「只增的累加器」改为**幂等重算**：v1.0 是 `spend = spend + excluded.spend`，回补 `?days=30` 会把历史重复累加一遍。改为按区间重算后 upsert 覆盖，配合 `gateway_spend_records` 的 `request_id` 去重，报表与账本才对得上。

---

### 6.5 阶段二遗留

| # | 限制 | 影响 |
|---|---|---|
| M1 | 扣款走定时任务，非实时 | 消费后到扣款之间有一个窗口（默认 5 分钟）内余额偏高。**真正的硬闸是 LiteLLM 的 `max_budget` / `blocked`**，所以这只是面板读数滞后，不是安全边界 |
| M2 | 无 outbox：任务失败靠下个周期重试 | 期间账本滞后；`request_id` 唯一约束保证重试不重复扣 |
| M3 | 分配忽略 Key 使用习惯 | 主用 Key 与闲置 Key 份额可能不理想；下一次同步即纠正 |
| M4 | 无汇率（§1） | LiteLLM 报表与真实美元支出不可比，有意为之 |
| M5 | 调度器内嵌在 Next.js 进程 | 多副本各跑一份（幂等，只是浪费调用）；滚动重启丢一次执行（靠回看窗口覆盖）。见 §6.6 |

---

### 6.6 本地调度

OpenMCP 不部署在 Vercel 上，没有 `vercel.json` 的 crons。任务由 `src/lib/litellm/local-cron.ts` 在 Next.js 进程内拉起（`instrumentation.ts` → `startLocalCronJobs()`）。

| 任务 | 默认频率 | 作用 |
|---|---|---|
| `gateway-settlement` | 5 分钟 | 扣余额 → 回推 `max_budget` → 记分成 → 重算日报表 |
| `gateway-budget-sync` | 1 小时 | 全量重算并下发 `max_budget`，自愈充值/购买时的同步失败 |

```bash
ENABLE_LOCAL_CRON=0                   # 关闭（默认开启）
GATEWAY_SETTLEMENT_INTERVAL_SEC=300   # 结算间隔，下限 30
GATEWAY_SETTLEMENT_DAYS=1             # 结算回看天数
GATEWAY_BUDGET_SYNC_INTERVAL_SEC=3600 # 自愈间隔，下限 60
GATEWAY_BUDGET_SYNC_LIMIT=200         # 每轮用户数上限
```

设计取舍：
- **直接调函数，不走 HTTP 回调自己的 `/api/cron/*`**，省一次网络往返，也不需要 `CRON_SECRET`。HTTP 端点保留给人工补数据。
- **首轮延迟一个周期再执行**：进程刚起时数据库与 LiteLLM 可能未就绪，立即跑容易制造假失败。
- **重入保护**：单次执行超过间隔时跳过后一轮，不让两次执行并发打同一批接口。
- **LiteLLM 未配置则不启动**（`LITELLM_MASTER_KEY` 为空），避免空转。
- **无分布式锁**：多副本下靠 `request_id` 唯一约束兜底。要省掉重复调用需改成 DB 锁。

---

## 7. 已知限制（v1.0 历史记录）

以下为 v1.0 时的状态，阶段二已处理的项目标注「已修复」：

| # | 限制 | 状态 |
|---|---|---|
| L1 | 多 Key 共享池未拆分 | ✅ 已修复（S3） |
| L2 | MCP/A2A 消费不回写 OpenMCP | ✅ 已修复（S1） |
| L3 | 无 outbox | ⚠️ 部分缓解（`request_id` 幂等 + 定时重试），outbox 未建 |
| L4 | 无汇率 | 有意为之，不修 |
| L5 | 同步窗口内并发调用可能短暂超发 | ⚠️ 缓解（余额归零即 `blocked`），预占未做 |

---

## 8. 验收标准

### v1.0（预算同步）

1. 余额 0 的用户签发 Key → LiteLLM 侧 `blocked = true`，网关调用返回拒绝。
2. 充值成功后 → 该用户所有 `provider='litellm'` 的 Key 都有非空 `max_budget`，且 `blocked = false`。
3. 购买付费 Skill 后再次同步 → `max_budget` 相应下调。
4. 同步失败时充值订单仍为 `paid`、余额已到账，并发出 `litellmBudgetUpdateFailed` 通知。
5. 重复调用同步不改变结果（幂等）。
6. LiteLLM 未配置（`LITELLM_MASTER_KEY` 为空）时同步返回 `skipped`，不影响主流程。
7. 存量回补端点能修复 `max_budget` 为 `null` 的历史 Key。

### v2.0（消费回写）

8. 同一 `request_id` 重复同步 → `balances` 只被扣一次，`gateway_spend_records` 只有一行。
9. 回补 30 天历史后，账本总额 == LiteLLM 报告总额，`provider_daily_usage` 不因重复回补而膨胀。
10. 扣款后立即同步：所有 Key 的 `(max_budget - spend)` 之和 == `balances.amountTotal`（误差 ≤ 1e-6）。
11. 单 Key 用户：该 Key 的 `max_budget - spend` == `amountTotal`。
12. 透支时 `amountTotal` 落到 0 而非负数，溢出额记入 `overspend_amount`。
13. MCP/A2A 消费产生 `provider_earnings` 记录，`net_amount == spend * 0.7`，一次消费不重复分成。
14. LiteLLM 不可用时同步任务返回 `skipped`，不修改任何账本。
15. 服务启动后日志出现 `[cron] 已启动 2 个任务：gateway-settlement@300s, gateway-budget-sync@3600s`。
16. `ENABLE_LOCAL_CRON=0` 启动时打印「已关闭，跳过定时任务启动」且不拉起任何 timer。

---

## 9. 代码锚点

| 模块 | 路径 |
|---|---|
| 预算同步服务 | `src/lib/litellm/budget-sync.ts` |
| 消费回写 / 分成 / 报表重算 | `src/lib/litellm/settlement.ts`（`settleGatewaySpend`） |
| 共享池分配（纯函数） | `src/lib/litellm/budget-alloc.ts`（`computeSharedPoolBudgets`） |
| 按 alias 更新 Key | `src/lib/litellm/virtual-keys.ts`（`updateKeyByAlias`） |
| 签发时带预算 / 状态查询 / 手动同步 | `src/server/routers/web/apiKeys.ts` |
| 充值后同步 | `src/payment/recharge/router.ts`、`src/payment/recharge/provider/{alipay,wechat}.ts` |
| 购买后下拉 | `src/web/skills/purchase.ts` |
| 共享池分配（纯函数） | `src/lib/litellm/budget-alloc.ts` |
| 预算下发 | `src/lib/litellm/budget-sync.ts` |
| 消费回写 / 分成 / 报表重算 | `src/lib/litellm/settlement.ts`（`settleGatewaySpend`） |
| 进程内定时任务 | `src/lib/litellm/local-cron.ts`，由 `src/instrumentation.ts` 启动 |
| 人工补数据端点 | `src/app/api/cron/budget-sync/route.ts`、`src/app/api/cron/provider-usage/route.ts` |
| 账本表 | `src/db/schema/registry-schema.ts`（`gatewaySpendRecords`） |
| Provider 分成 | `src/web/providers/settlement.ts` |
| 面板告警 | `src/app/[locale]/(protected)/(console)/dashboard/apikeys/page.tsx` |
