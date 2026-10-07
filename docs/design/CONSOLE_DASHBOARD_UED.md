# Console Dashboard UED Redesign

> Scope: `apps/openmcp` user console (`/dashboard`, `/settings`, `/guide`).  
> Branch: `develop-mcp`. Confirmed: keep old routes working; sidebar uses new IA links.

## Goals

1. Reorganize console IA into four clear groups: **工作台 / 使用 / 发布 / 账户**.
2. Separate **buyer (usage)** and **seller (publish/earnings)** surfaces.
3. Hide **发布** for non-providers; soft-guide publish URLs to `/provider/onboarding`.
4. Complete account settings (profile, security email, org, invoice profile).
5. Do not delete old paths — leave functional or soft-redirect later.

## Target sidebar IA

### 工作台


| Label | Path         | Notes    |
| ----- | ------------ | -------- |
| 概览    | `/dashboard` | Existing |


### 使用（all users）


| Label  | Path                   | Notes                                                              |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| 用量与花费  | `/dashboard/usage`     | NEW — 汇总卡片 + 月度账单 + 用量明细（原 `/dashboard/billing/monthly` 已合并，重定向至此） |
| 余额与充值  | `/dashboard/recharge`  | Existing; new sidebar label                                        |
| API 密钥 | `/dashboard/apikeys`   | Existing                                                           |
| 我的收藏   | `/dashboard/favorites` | Existing                                                           |
| 我的安装   | `/dashboard/installs`  | Existing; merged skills + MCP/A2A installs (download page removed) |


### 发布（provider only — `requireProvider: true`）


| Label         | Path                       | Notes                      |
| ------------- | -------------------------- | -------------------------- |
| 我的资产 · MCP    | `/dashboard/assets/mcp`    | Existing                   |
| 我的资产 · A2A    | `/dashboard/assets/a2a`    | Existing                   |
| 我的资产 · Skills | `/dashboard/assets/skills` | Existing                   |
| 收益与打款         | `/dashboard/earnings`      | NEW (wrap/enhance income)  |
| 入驻与收款         | `/provider/onboarding`     | Link to `/provider/payout` |


Hide entire **发布** group when user is not a verified/onboarded provider (`dashboard.getUserProviderStatus` → `isProvider`). If they hit a publish URL while not onboarded → CTA to `/provider/onboarding` (not hard 404).

### 账户


| Label | Path                     | Notes                                                       |
| ----- | ------------------------ | ----------------------------------------------------------- |
| 账户设置  | `/settings/setup`        | NEW — left rail: 资料 / 安全 / 实名 / 企业 / 收款（`?section=` 同步）     |
| 个人资料  | `/settings/profile`      | Enhance — merged 安全（password + bind email + delete account） |
| 企业主体  | `/settings/organization` | NEW — company KYC / upgrade CTA                             |
| 发票信息  | `/settings/invoice`      | NEW — store profile only                                    |
| 使用指南  | `/guide`                 | Existing                                                    |


### Removed from sidebar

- Group name「我的工作流」
- Mixed「个人设置」hub dumping API keys + bills + income together
- Sidebar label「消费账单」→ replaced by 「用量与花费」（内含月度账单，旧 `/settings/bills` kept）
- 「我的下载」page + sidebar entry (download == install; server keeps `skill_downloads`)

## Old routes (kept)


| Old                         | Status                                                  |
| --------------------------- | ------------------------------------------------------- |
| `/settings?section=account` | Keep functional                                         |
| `/settings/bills`           | Keep (recharge-focused / note)                          |
| `/settings/income`          | Keep; Batch E may soft-redirect → `/dashboard/earnings` |
| `/dashboard/assets/*`       | Unchanged                                               |


## Batches


| Batch | Commit theme          | Deliverables                                                                                                               |
| ----- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **A** | Sidebar IA + routes   | Route enums, `getUserSidebarLinks` 4 groups, `requireProvider` filter (group + nested), i18n zh/en, design doc, stub pages |
| **B** | Account completeness  | Richer profile, security email bind, payout entry points, settings hub cards                                               |
| **C** | Usage + monthly bills | `/dashboard/usage`（单页含月度账单与明细）, `dashboard.getUsageEvents` / `dashboard.getMonthlyBilling` MVP                             |
| **D** | Enterprise + invoice  | `/settings/organization`, `/settings/invoice` (`invoiceProfile` metadata)                                                  |
| **E** | Provider earnings     | `/dashboard/earnings` tabs, asset engagement metrics, dual dashboard cards                                                 |


## Filtering notes

- `MenuItem.requireProvider` already exists on the type.
- Sidebar previously filtered only **top-level** links; nested `requireProvider` (e.g. income) was ignored.
- After Batch A: filter top-level groups **and** nested items; drop empty groups.

## Invoice constraint

Store invoice profile data only (`invoiceProfile` JSON). Real tax invoicing API is out of scope.

## i18n

Chinese primary UI; keep `messages/en.json` in sync for all new keys under `Dashboard.*`.