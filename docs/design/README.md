# OpenMCP 模块设计文档索引

产品真相来源（仓库级）：[../../docs/PRODUCT.md](../../docs/PRODUCT.md)

## 核心（优先阅读）

| 文档 | 说明 |
|------|------|
| [SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md) | **上架 / 扫描门控 / certified 统一规范** |
| [SKILL_SECURITY_SCAN_PIPELINE.md](./SKILL_SECURITY_SCAN_PIPELINE.md) | **扫描流水线：独立模块 `packages/security-scan` + console 按部署环境取源（Vercel Sandbox / 本地 clone）** |
| [USER_MARKETPLACE.md](./USER_MARKETPLACE.md) | 普通用户浏览与免费/付费获取 |
| [SKILL_USER_DOWNLOAD_INSTALL.md](./SKILL_USER_DOWNLOAD_INSTALL.md) | 下载 / 安装 / 下载列表 / Agent OAuth（登录必需） |
| [AGENT_INSTALL.md](./AGENT_INSTALL.md) | 「装进 Agent」提示词 + Store MCP |
| [API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md) | **API Key 架构：LiteLLM 代理签发 + 本地索引 + 删除同步** |
| [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md) | **网关预算桥：余额 → `max_budget` + 余额不足拦截（数值直传，不换算）** |
| [SKILL_DETAIL_EVAL_DESIGN.md](./SKILL_DETAIL_EVAL_DESIGN.md) | 详情页 × 门控 × 评测结合方案 |
| [OPENMCP_EVAL_V1.md](./OPENMCP_EVAL_V1.md) | **openmcp-eval-v1 维度字典与启发式公式** |
| [PROVIDER_GATEWAY_REGISTRATION_UED.md](./PROVIDER_GATEWAY_REGISTRATION_UED.md) | Provider 注册 MCP/A2A/Skills UED |
| [OPENPAY_SITE_UED.md](./OPENPAY_SITE_UED.md) | **全站 UED：免费线 / 收费线（OpenPay）双轨 + 完整线框图** |
| [SKILLPAY_ONBOARDING_PLAN.md](./SKILLPAY_ONBOARDING_PLAN.md) | SkillHub 入驻教程抓取原文 + OpenPay 落地方案 |
| [SKILLPAY_ONBOARDING_UED.md](./SKILLPAY_ONBOARDING_UED.md) | 入驻 UED（部分被 OPENPAY_SITE_UED 取代） |
| [ADMIN_REVIEW_QUEUE_UED.md](./ADMIN_REVIEW_QUEUE_UED.md) | Admin 人工复核 UED |
| [design-github-repos-skills-webhook-sync.md](./design-github-repos-skills-webhook-sync.md) | GitHub → openmcp webhook 同步 |
| [design-vercel-egress-proxy-and-sandbox.md](./design-vercel-egress-proxy-and-sandbox.md) | **国内 VPC × Vercel Hobby：GitHub 出口转发代理 + Sandbox 扫描编排 + 部署步骤** |
| [CONSOLE_OPEN_RADAR_API.md](./CONSOLE_OPEN_RADAR_API.md) | **`apps/console` 开放 API：API Key 签发 / 仓库创建 + 回调 / 统计与排行 / 订阅推送** |

## 商业 / 选型决策

| 文档 | 说明 |
|------|------|
| [OPENMCP_COMMERCIAL_PLAN.md](./OPENMCP_COMMERCIAL_PLAN.md) | 平台商业闭环：市场 × 网关 × 分成 |
| [CONSOLE_RADAR_COMMERCIAL_PLAN.md](./CONSOLE_RADAR_COMMERCIAL_PLAN.md) | **`apps/console` = OpenMCP 雷达开源选型决策引擎：商业方案 × 与 web 的 API 协同契约** |

## 已迁出

n8n 工作流社区相关设计已迁至 **`apps/base/docs/`**（含 WORKFLOW_*、`llm-schema-usage-analysis.md`），不定义 OpenMCP 核心。
