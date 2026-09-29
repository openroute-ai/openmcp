# 支付接入方案（微信 / 支付宝 / 对公转账）

> 状态：**待实现方案**。本文基于对 `openmcp`（目标仓）与 `n8nshow`（来源仓）的实际代码勘察写成。
> 结论先行：**支付与「先付费后下载」的机制已经存在且可用，缺的是「充值/下单/结算」这一半。**
> 来源仓的对应实现存在严重安全问题，不能照搬，具体见 [§4](#4-不能照搬来源仓的三处安全问题)。

---

## 1. 现状盘点

### 1.1 已经存在，不要重写

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 支付 Provider 包 | `packages/payment/` | ✅ 完整实现，非桩代码（wechat 596 / alipay 510 / stripe 591 行） |
| 微信/支付宝下单与验签 | `packages/payment/src/provider/{wechat,alipay}.ts` | ✅ 已实现 |
| 微信/支付宝工具（签名、XML、回调） | `packages/payment/src/utils/` | ✅ 已实现 |
| 订单表 `recharge_orders` | `packages/db/src/auth-schema.ts` | ✅ 建表已存在，字段完整（含 `webhookReceived` / `webhookData` / `thirdPartyOrderId` / `expiresAt`） |
| 授权表 `skill_entitlements` | `packages/db/src/mcp-schema.ts` | ✅ 已存在，`unique(userId, skillId)` |
| 钱包表 `balances` | `packages/db/src/workflow-schema.ts` | ✅ 已存在 |
| 钱包扣款 + 写授权 | `apps/web/src/web/skills/purchase.ts` | ✅ 已实现（事务内扣款 + 幂等） |
| **付费才能下载**的闸门 | `apps/web/src/web/skills/acquire.ts:109` | ✅ 服务端强制，非前端隐藏 |
| 支付状态前端 store | `apps/web/src/lib/stores/payment-store.ts` | ⚠️ `fetchPayment` 是空实现 |

`acquire.ts` 的闸门是关键，已经是对的：

```ts
if (skill.priceType === 'paid') {
  const entitled = await userHasSkillEntitlement(params.userId, skill.id)
  if (!entitled) return { ok: false, code: 'NEED_PURCHASE', error: '请先购买' }
}
```

### 1.2 真正缺失的部分

- ❌ **没有任何代码调用 `createPaymentProvider`** —— Provider 写了但从未被实例化
- ❌ `recharge_orders` 表**有表无代码**：无 `web/recharge-orders/` 数据访问层
- ❌ **无回调路由**：`apps/web/src/app/api/` 下只有 `auth` 和 `trpc`，无 `webhook/alipay`、`webhook/wechat`
- ❌ 无下单入口（`createRechargePayment`）
- ❌ 无 `/settings/recharge` 页面（`purchase.ts` 里 `rechargeUrl: '/settings/recharge'` 指向一个 **404**）
- ❌ 无对公转账（汇款识别码 → 人工核销）流程
- ❌ 无「回调成功 → 钱包入账」的服务

**结论：闭环断在「用户没法给钱包充值」这一环。** 现在付费技能必然卡在 `NEED_RECHARGE` → 跳 404。

---

## 2. 目标架构

```
用户点「充值」
      │
      ▼
recharge.createPayment  (protectedProcedure)
      │  1. 服务端按 amount 生成 order（金额只认服务端，不认前端）
      │  2. 调 createPaymentProvider(PAYMENT_PROVIDER) → 拿到支付链接/二维码
      │  3. 落库 recharge_orders(status='pending', expiresAt)
      ▼
用户用微信/支付宝付款
      │
      ▼
POST /api/webhook/{wechat,alipay}   ← 平台异步通知（唯一可信的资金事实）
      │  1. 验签（微信 v3 证书 / 支付宝 RSA2）
      │  2. 幂等：webhookReceived 已为 true 直接返回 success
      │  3. 事务：订单置 paid → balances.amount += amount
      ▼
前端轮询 recharge.checkStatus → 显示余额到账
      │
      ▼
用户购买技能 → purchase.createSkillPurchase 扣余额 → 写 skill_entitlements
      │
      ▼
acquireSkill 校验 entitlement → 放行下载/安装   （已存在）
```

**对公转账**走另一条支线：用户线下汇款并填写**汇款识别码** → 管理员在后台核销 → 同样写入 `balances`。

---

## 3. 分阶段实施

### 阶段 0：安全基线（前置，不可跳过）

1. 新建 `apps/web/src/server/payment/config.ts`：从 `websiteConfig.payment.provider` + 环境变量组装 `PaymentProviderConfig`
2. 单例 `getPaymentProvider()`，内部调 `createPaymentProvider`；启动时用 `missingCredentials()` 校验，缺 key 直接抛错（**不要**静默降级）
3. 新增环境变量：`ALIPAY_*` / `WECHAT_*`（见 §6）

```ts
// apps/web/src/server/payment/config.ts（要点）
import { createPaymentProvider, missingCredentials, type PaymentProvider } from '@workspace/payment'

let provider: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider
  const name = websiteConfig.payment.provider
  const credentials = { ALIPAY_APP_ID: process.env.ALIPAY_APP_ID, /* ... */ }
  const missing = missingCredentials({ provider: name, credentials })
  if (missing.length) throw new Error(`[payment] ${name} 缺少配置: ${missing.join(', ')}`)
  provider = createPaymentProvider({ provider: name, credentials, isProduction: true }, deps)
  return provider
}
```

> `packages/payment` 已经是独立 package 且**不读 `process.env`**（依赖由宿主注入），这条解耦约束要保持住。

### 阶段 1：下单 + 回调（微信/支付宝）

**1.1 数据访问层** `apps/web/src/web/recharge-orders/index.ts`
- `createRechargeOrder` / `getRechargeOrderByOrderId` / `markOrderPaid`（带 `webhookReceived` 幂等）/ `listOrdersByUser`

**1.2 tRPC 路由** `apps/web/src/web/recharge-orders/router.ts`

| Procedure | 类型 | 说明 |
| --- | --- | --- |
| `createPayment` | `protectedProcedure` | 入参只有 `amount` + `method`；**金额与 currency 由服务端决定** |
| `checkStatus` | `protectedProcedure` | 轮询订单状态 |
| `history` | `protectedProcedure` | 我的充值记录 |

**1.3 回调路由**
- `apps/web/src/app/api/webhook/alipay/route.ts` — `form-urlencoded`，验签用 **RSA2**，成功返回纯文本 `success`
- `apps/web/src/app/api/webhook/wechat/route.ts` — 解析 XML，验签，返回 XML

关键约束：
- `export const runtime = 'nodejs'` + `dynamic = 'force-dynamic'`
- **验签失败一律拒绝**，且不要因为业务处理失败就返回 `failure`（会触发平台无限重试）——记录 + 返回 success，另配告警邮件
- 复用已有 `packages/mail` 的 `wechat-webhook-failed.tsx` 模板告警

**1.4 入账**（事务）
```
UPDATE recharge_orders SET status='paid', paidAt=now(), webhookReceived=true, thirdPartyOrderId=? WHERE orderId=? AND webhookReceived=false
-- 影响行数 = 0 → 已处理过，直接返回成功（幂等）
UPDATE balances SET amount = amount + ?, amountTotal = amountTotal + ? WHERE userId=?
```

### 阶段 2：充值页 UI

`/settings/recharge`（受保护路由）：
- 金额选择（预设档位 + 自定义，**服务端再校验一次**）
- 支付方式选择：微信 / 支付宝 / 对公转账
- 微信、支付宝：展示二维码 + 轮询状态
- 对公转账：展示收款信息 + 自动生成的**汇款识别码**，提示用户填入备注栏

> ⚠️ 收款账号**必须来自服务端配置**，不要硬编码在前端组件里（来源仓的问题，见 §4.3）。

### 阶段 3：对公转账人工核销

对公转账没有平台回调，闭环靠人：
1. 用户下单生成 `remittanceCode`（如 `RC` + 时间戳 + 随机段，不可枚举）
2. 状态停在 `pending_transfer`
3. 管理员后台按识别码 + 银行流水核对 → 确认到账
4. 确认动作复用阶段 1.4 的同一段入账逻辑

需要新增表：

```ts
export const bankTransferVouchers = pgTable('bank_transfer_vouchers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().unique(),
  remittanceCode: text('remittance_code').notNull().unique(),
  userId: text('user_id').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  payerName: text('payer_name'),          // 汇款方户名，用于人工比对
  voucherUrl: text('voucher_url'),        // 凭证截图
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending|confirmed|rejected
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### 阶段 4：接上「先付费后下载」

现有链路已通，阶段 4 只补两处断点：
1. 修复 `rechargeUrl: '/settings/recharge'` 的 404（阶段 2 完成后自然解决）
2. 实现 `payment-store.ts` 的 `fetchPayment`，让余额在客户端可读（当前是空函数）

---

## 4. 不能照搬来源仓的三处安全问题

### 4.1 充值订单接口完全没有鉴权 🔴

`n8nshow/.../src/web/recharge-orders/router.ts` 整个 router **全部是 `publicProcedure`**：

```ts
createRechargeOrder: publicProcedure.input(z.object({
  orderId: z.string(),
  userId: z.string(),     // ← 前端指定要给谁充值
  amount: z.string(),     // ← 前端指定充多少
  status: z.string().optional(),   // ← 前端可以直接写 'paid'
  ...
```

任意未登录请求都能：伪造订单、**把状态直接写成 `paid`**、替任意 `userId` 充值。必须改为 `protectedProcedure`，且 `userId` 从 session 取、`status` 由服务端流转。

### 4.2 入账信任前端 🔴

若按来源仓那样「前端提交 status=paid → 服务端加余额」，攻击者直接改请求体即可免费获得任意金额余额。**余额只能由已验签的回调或管理员核销驱动。**

### 4.3 收款账号硬编码在前端组件 🔴

`n8nshow/.../settings/recharge/bank-card.tsx` 把完整公司银行账号写死在 `'use client'` 组件里：
```ts
const transferInfo = `户名：…公司\n银行账号：6228 4000 2701 2930 467\n开户行：…`
```
前端组件会被打进 JS bundle，任何人都能提取。且换账号要改代码重新发版。必须移到服务端配置（`websiteConfig` + 环境变量）。

---

## 5. 验证清单

- [ ] 无 `balance` 行时，付费技能返回 `NEED_RECHARGE` 且 `rechargeUrl` 可达（非 404）
- [ ] 伪造 `status='paid'` 的下单请求被拒（应忽略或 401/403）
- [ ] 回调**不带签名 / 签名错误** → 不入账，返回 `failure`
- [ ] 同一回调**重复投递 3 次** → 余额只增加一次（幂等）
- [ ] 回调金额与订单金额不一致 → 拒绝并告警
- [ ] 过期订单（`expiresAt` 已过）不接受回调入账
- [ ] 付费技能未购买时 `acquireSkill` 返回 `NEED_PURCHASE`
- [ ] 已购买后同一技能可重复下载（`alreadyOwned` 走通）
- [ ] 微信/支付宝沙箱各跑通一次完整闭环
- [ ] 对公转账：识别码可生成、可被管理员核销、核销后到账
- [ ] 支付包不直接读 `process.env`（保持依赖注入）

---

## 6. 环境变量

```bash
# 渠道选择
PAYMENT_PROVIDER=wechat            # wechat | alipay | stripe

# 微信支付
WECHAT_APP_ID=
WECHAT_MCH_ID=
WECHAT_API_KEY=
WECHAT_PRIVATE_KEY=
WECHAT_PLATFORM_CERT_PATH=
WECHAT_NOTIFY_URL=https://<domain>/api/webhook/wechat
WECHAT_RETURN_URL=

# 支付宝
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=
ALIPAY_NOTIFY_URL=https://<domain>/api/webhook/alipay
ALIPAY_RETURN_URL=
ALIPAY_GATEWAY=                     # 留空 = 沙箱，生产显式设置为 openapi.alipay.com

# 对公转账（阶段 3）
BANK_TRANSFER_ACCOUNT_NAME=
BANK_TRANSFER_ACCOUNT_NUMBER=
BANK_TRANSFER_BANK_NAME=
BANK_TRANSFER_BRANCH_NAME=
```

> 回调地址必须是公网可达的 HTTPS 域名，微信/支付宝后台需白名单配置。

---

## 7. 建议实施顺序

1. **阶段 0 + 阶段 1**（微信/支付宝闭环）—— 这是最小可用闭环，也是风险最高、最需要仔细 review 的部分
2. **阶段 4**（修 404 + 补 store）—— 让付费技能真的能走通
3. **阶段 2 + 阶段 3**（UI + 对公转账）
4. 后续可再考虑退款、订单对账、分账（`creditProviderEarning` 已有雏形）

**在阶段 0/1 落地前，不要动 `packages/payment` 里的 Provider 实现**——那部分已经写好且未被调用，改造它没有收益。
