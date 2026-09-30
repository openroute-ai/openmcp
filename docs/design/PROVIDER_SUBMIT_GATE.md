# 提供者提交门禁与收款绑定（实现说明）

> 日期：2026-09-20  
> 相关：`PROVIDER_GATEWAY_REGISTRATION_UED.md`、`providerProfiles` schema

## 统一提交壳

`/mcp/submit`、`/a2a/submit`、`/skills/submit` 共用：

1. **未登录** → `ProviderNotLogin`
2. **已登录** → `ProviderSubmitGate`（内含 `ProviderSubmitShell` 三步指示：登录 → 实名认证 → 上传/设置）

门禁逻辑（`providers.getMyProfile`）：

| 状态 | UI |
|---|---|
| loading | Skeleton |
| 无档案 / unverified / rejected | CTA → `/provider/onboarding`（驳回展示 `verificationNote`） |
| pending | 「审核中」Card，不渲染表单 |
| verified | 渲染表单；`payChannelStatus !== ready` 时警告并链到 `/provider/payout` |

表单内不再单独做「是否已入驻」软门禁（已由 Gate 覆盖）。

## 服务端强制

`requireVerifiedProviderForPublish(userId, { requirePayChannel })`：

- 注册/接入 MCP、A2A、Skills（含 ZIP `/api/skills/upload-zip`）须 `verificationStatus === 'verified'`
- 付费资产（`priceType === 'paid'`）额外要求 `payChannelStatus === 'ready'`
- 错误信息为中文

## 收款绑定

- 页面：`/provider/payout`（登录门禁）
- tRPC：`providers.updatePayChannel` → 写 `payChannelType`、`metadata.payoutAccounts.{wechat|alipay}`，`payChannelStatus = ready`
- **不做**微信/支付宝商户 OAuth，仅平台汇款用账号绑定
- 入口：KYC 表单提示、入驻页、提交门禁警告、`/settings/income`

## Skills 提交页

`skills/submit/components/skill-submit-form.tsx` 与 MCP/A2A 同为 `@workspace/ui` Card/Form；GitHub 走 `skills.connectFromGithub`，ZIP 走 `/api/skills/upload-zip`；已去掉假随机 stars / 外跳 GitHub PR 的 mock 行为。
