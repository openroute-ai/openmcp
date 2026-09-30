# Provider 分成与提现（Skill 销售 + MCP/A2A 调用）

> 日期：2026-09-28  
> 相关：`USER_MARKETPLACE.md`、`PROVIDER_SUBMIT_GATE.md`、`LITELLM_BUDGET_SYNC.md`、migration `0008_provider_settlement`、`0016_gateway_spend_records`

两类收入共用同一张 `provider_earnings` 表与同一套 70/30 比例。

| 来源 | 触发时机 | 关联字段 |
|---|---|---|
| **Skill 付费购买** | 钱包扣款 + `skill_entitlements` 写入成功后 | `skill_id` + `entitlement_id` |
| **MCP / A2A 调用** | 网关消费结算（`settleGatewaySpend`）落账本时 | `gateway_record_id` → `gateway_spend_records.id` |

## 分成规则

| 项 | 值 |
|---|---|
| Provider 分成 | **70%**（`PROVIDER_REVENUE_SHARE = 0.7`） |
| 平台抽成 | **30%** |
| 触发时机 | Skill 购买成功 / 网关消费结算 |

Skill 路径调用 `creditProviderEarning`，分成失败**不回滚买家授权**（记日志）。
网关路径在 `settleGatewaySpend` 内由 `creditGatewayEarnings` 记账，`gateway_record_id` 唯一 → 一次消费只分成一次，重跑结算安全。

**货币口径**：与钱包一致，`CNY` 裸数值，OpenMCP ↔ LiteLLM 不做换算（见 [LITELLM_BUDGET_SYNC.md §1](./LITELLM_BUDGET_SYNC.md)）。

**精度限制**：`provider_earnings` 金额字段是 `decimal(10,2)`，两位小数。极小额的网关调用分成会被舍入为 0 —— 这是表精度决定的，不影响账本（`gateway_spend_records.spend` 是 8 位小数）。

## 数据表

### `provider_earnings`

- `gross_amount` / `platform_fee` / `net_amount`
- `status`: `pending` | `payable` | `paid`
- 关联 `author_id`
- **Skill 销售**：`skill_id`（非空）+ 可选 `entitlement_id`
- **网关调用**：`skill_id` 为 null，`gateway_record_id` 非空且唯一

### `gateway_spend_records`

网关消费账本（v2.0 新增），`provider_earnings.gateway_record_id` 指向它。

- `request_id` **唯一** —— 消费扣款的幂等键
- `spend` / `overspend_amount`（余额扣到 0 后的溢出额，不写负余额）/ `total_tokens`
- `asset_type` + `asset_name` + `author_id`：Provider 归属
- `occurred_at`（消费发生时间）用于按区间重算报表

### `provider_payout_requests`

- Provider 申请提现；`status`: `pending` | `approved` | `rejected` | `paid`
- 快照 `payout_channel` / `payout_account`（来自收款绑定）

## Provider API（tRPC `providers.*`）

| 过程 | 说明 |
|---|---|
| `listMyEarnings` | 分成明细 + 可提现/已付汇总 |
| `listMyPayoutRequests` | 本人提现申请列表 |
| `requestPayout` | 申请提现（需 `payChannelStatus=ready` 且已绑定微信/支付宝账号；同时仅允许一笔 pending） |

## Admin API（tRPC `admin.providers.*`）

| 过程 | 说明 |
|---|---|
| `listPayoutRequests` | 按状态筛选提现申请 |
| `updatePayoutRequest` | `approved` / `rejected` / `paid`；标记 `paid` 时按 FIFO 将对应 `payable` earnings 置为 `paid` |

## UI

- Provider：`/settings/income` — 分成汇总、明细（Skill 与网关调用混合，Skill 行显示标题、网关行显示资产名）、申请提现；收款账户链到 `/provider/payout`
- Admin：`/admin/provider-payouts` — 列表审批 / 驳回 / 标记已打款

## 迁移

```bash
# apps/openmcp
pnpm drizzle-kit migrate   # 或项目既有 migrate 脚本
# 0008_provider_settlement.sql            — provider_earnings / payout_requests
# 0016_gateway_spend_records.sql          — gateway_spend_records + provider_earnings 网关字段
```

## 定时任务

网关调用分成依赖结算任务。**OpenMCP 不部署在 Vercel 上**，因此没有 `vercel.json` 的 crons；
任务由 `src/lib/litellm/local-cron.ts` 在 Next.js 进程内调度（`instrumentation.ts` 启动时拉起）。

| 任务 | 默认频率 | 作用 |
|---|---|---|
| `gateway-settlement` | 5 分钟 | 扣余额 → 回推 `max_budget` → 记分成 → 重算日报表 |
| `gateway-budget-sync` | 1 小时 | 给所有网关用户重算并下发 `max_budget`（自愈漂移） |

覆盖全部环境变量（均为可选）：

```bash
ENABLE_LOCAL_CRON=0                        # 关闭定时任务（默认开启）
GATEWAY_SETTLEMENT_INTERVAL_SEC=300        # 结算间隔，下限 30
GATEWAY_SETTLEMENT_DAYS=1                  # 结算回看天数
GATEWAY_BUDGET_SYNC_INTERVAL_SEC=3600      # 预算自愈间隔，下限 60
GATEWAY_BUDGET_SYNC_LIMIT=200              # 每轮处理的用户数上限
```

人工补数据 / 排障仍可走 HTTP 端点（`CRON_SECRET` 未配置时仅开发环境可用）：

```
GET /api/cron/provider-usage?days=30   # 回填历史
GET /api/cron/budget-sync?userId=<id>  # 单用户预算自愈
```

两个性质需要知道：
- **多副本各跑一份**，靠 `request_id` 唯一约束保证不重复扣款，只是浪费 API 调用。
- **重启丢一次执行**，靠下一轮回看窗口覆盖，不影响正确性。
