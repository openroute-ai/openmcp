# 普通用户市场：浏览与免费 / 付费获取（补齐稿）

> 版本：v0.5（2026-09-28）· 免费+付费钱包解锁已落地 · **全面登录要求** · Agent OAuth · 网关额度同步  
> 对齐：[PRODUCT.md](../../docs/PRODUCT.md)、[SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md)  
> 下载安装详细设计：[SKILL_USER_DOWNLOAD_INSTALL.md](./SKILL_USER_DOWNLOAD_INSTALL.md) ⬅️ **v2.0 重写：登录必需 + Agent OAuth**  
> API Key 架构：[API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md) ⬅️ **Dashboard 代理签发 LiteLLM Virtual Key（一把 Key 两处用）**  
> 代码锚点：`src/web/skills/index.ts`（仅 `status=published`）、`priceType` / `downloads` 字段

> ⚠️ **重要变更**（v2.0）：所有 Skill 下载/安装路径（含 `/package`、Store MCP `install_asset`）**均需登录**，取消匿名访问。详见 [SKILL_USER_DOWNLOAD_INSTALL.md](./SKILL_USER_DOWNLOAD_INSTALL.md)。

> ℹ️ **Key 来源**（v0.4）：`/dashboard/apikeys` 签发的是 LiteLLM Virtual Key（`sk-…`），同一把 Key 既可下载 Skill 包 / 注册 Store MCP，也可直接调用平台网关的市场 MCP / A2A。
>
> ℹ️ **网关额度**（v0.5）：Key 的 `max_budget` 跟随钱包余额自动同步，余额耗尽时网关调用被拒绝。口径见 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md)。

---

## 1. 目标

普通用户（开发者 / Agent 团队）可以：

1. 浏览、搜索、筛选已上架资产（Skills；MCP/A2A 端点资产见 Provider UED 的市场侧展示，本迭代先保证 Skills）  
2. **免费**获取或 **付费**购买/下载  
3. 识别安全与认证信息（`securityGrade` 徽标、`certified`）

---

## 2. 可见性规则

- 列表 / 详情默认只出现 `status === 'published'`。  
- `scanning` / `pending_review` / `rejected` / `needs_revision` / `draft` **不对**普通用户展示。  
- 筛选建议：分类、`priceType`（free/paid）、`certified`、排序（最新 / 下载 / 热度 / 浏览）。

---

## 3. 免费获取（已实现）

| 步骤 | 说明 |
|------|------|
| 详情页 CTA | `SkillPurchase`「免费获取」按钮 |
| 登录 | **强制登录**（`skills.acquire` 为 `protectedProcedure`），未登录弹出登录框 |
| 服务端 | `skills.acquire`：仅 `status===published`；免费立即放行；付费未授权返回「请先购买」 |
| 计数 | 写入 `skill_downloads` + `skills.downloads++` |
| 交付 | `sourceType===github` → `{ kind:'github', githubUrl, installNotes }`；zip / `metadata.sourceFiles` → `{ kind:'files', files, downloadUrl }` |
| ZIP | `GET/POST /api/skills/[id]/download` 流式返回 store-method ZIP（需登录） |
| 安装指引 | 返回 `platforms` + 中文安装 tips；caution 附 `riskWarning`（来自 `securityLlmAnalysis.riskSummary` 或 flags） |
| UI | 成功后 Dialog：可复制 GitHub URL / 文件列表 +「下载 ZIP」；toast 成功；刷新详情 downloads |

代码锚点：`src/web/skills/acquire.ts`、`src/web/skills/router.ts`（`acquire`）、`src/components/skills/skill-purchase.tsx`、`src/app/api/skills/[id]/download/route.ts`

---

## 4. 付费获取（已实现 · 钱包 MVP）

| 项 | 约定 |
|----|------|
| 价格字段 | `priceType=paid` + `priceAmount` / `billingModel` / `unitPrice` / `currency` |
| 授权表 | `skill_entitlements`（unique userId+skillId；含 orderId / amount / currency） |
| 下单 | `skills.createPurchase`：校验 published+paid+price → 扣 `balances.amount`（CNY）→ 写 entitlement；已购则幂等返回 |
| 余额不足 | 返回 `needRecharge` + 链到 `/settings/recharge`（微信/支付宝直连下单可后续补齐） |
| 获取 | 已购走与免费相同的 `skills.acquire` 交付 UI；未购 `acquire` 返回「请先购买」 |
| UI | 付费按钮：未购「立即购买」/ 已购「立即获取」；不足时显示「去充值」 |

代码锚点：`src/web/skills/purchase.ts`、`skill_entitlements` schema、`SkillPurchase` 付费分支

> 说明：当前 MVP **仅支持钱包扣款**；WeChat/Alipay checkout 可在既有 recharge provider 上扩展。

---

## 5. 信任展示

| 展示 | 来源 |
|------|------|
| 安全徽标 | `securityGrade`：safe 绿 / caution 黄（可下载但提示风险） |
| 已认证 | `certified=true` |
| 作者 | `authors` + verified |

caution 自动上架时，详情页须展示风险摘要（可来自 `securityLlmAnalysis.riskSummary` 或 flags 计数）。

---

## 6. 验收标准

1. 未 published 的 Skill 不出现在市场列表。  
2. free Skill 可完成获取并增加 downloads（需登录）。  
3. paid Skill 展示价格；支付闭环按实现进度勾选。  
4. certified / securityGrade 展示与 `SKILLS_PUBLISH_POLICY.md` 一致。  
5. Agent 侧下载走 `/api/skills/[id]/package` + Bearer Key（与 Web 的 `/download` 会话路径分离）。  
6. 充值后网关 Key 的 `max_budget` 被同步为「可用余额 + 已花费」，余额为 0 时 Key 被 `blocked`。见 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md) §7。
