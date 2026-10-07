# Skill 用户下载与安装：NEW 实现设计

> **版本**：v2.1（2026-09-27）  
> **范围**：`apps/openmcp` · 终端用户如何下载并安装 Provider 发布的 Skills  
> **状态**：✅ **P0 已完成** · ✅ **P1 已完成** · ✅ **P2 已完成**  
> **未来迭代**：深度链接一键安装、完整版本管理、Refresh Token  
> **关联**：[USER_MARKETPLACE.md](./USER_MARKETPLACE.md)、[AGENT_INSTALL.md](./AGENT_INSTALL.md)、[API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)、[SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md)
>
> ⚠️ **变更（2026-10-07）**：前端「我的下载」页面与侧边栏入口已删除（下载即安装）。`skill_downloads` 表与写入保留；安装记录统一由 `asset_installs` + `/dashboard/installs` 呈现（见 `CONSOLE_DASHBOARD_UED.md`）。

---

## P0 实现状态（2026-09-22）

✅ **已完成**：
1. ✅ OAuth Device Code Flow (device, token, authorize endpoints + /device page)
2. ✅ 强制登录 `/api/skills/[id]/package`（session/Bearer/OAuth）
3. ✅ `skill_downloads` 表扩展（status, skillVersion, skillTitle, skillSlug）
4. ✅ `/dashboard/downloads` 页面（Skill 下载列表 + 再次下载）
5. ✅ `buildSkillPackage` 注入 `openmcp` 元数据块
6. ✅ Skills 列表卡片显示 securityGrade 徽标（safe/caution）
7. ✅ 数据库迁移：`0012_oauth_and_skill_downloads_p0.sql`
8. ✅ Store MCP `install_asset` 强制认证（OAuth + API key）
9. ✅ Store MCP OAuth 支持（auth.ts 扩展 resolveOAuthToken）
10. ✅ Store MCP 记录 skill_downloads（一致 upsert 模式）
11. ✅ 侧边栏「我的下载」链接（sidebar-config.tsx）

## P1 实现状态（2026-09-22）

✅ **已完成**：
1. ✅ `skill_installs` 表（migration 0013）
2. ✅ Install-callback API：`POST /api/skills/[id]/install-callback`
3. ✅ `/dashboard/installs` 页面（「我的安装」列表 + 筛选 + 操作）
4. ✅ 侧边栏「我的安装」链接
5. ✅ API 端点：`GET /api/skills/installs` 和 `PATCH /api/skills/installs/[id]`

📝 **Agent 集成说明**：
- Agent 应在本地成功安装 Skill 后调用 `/api/skills/[id]/install-callback`
- Store MCP `install_asset` 返回安装包内容，由 Agent 负责实际安装和回调

## P2 实现状态（2026-09-22）

✅ **已完成**：
1. ✅ Authorization Code Flow（Browser Redirect OAuth）
   - ✅ `oauth_authorization_codes` 表（migration 0013）
   - ✅ `oauth_clients` 表 + 默认 public client (openmcp-store)
   - ✅ `GET/POST /api/mcp/store/oauth/authorize` 端点
   - ✅ `/oauth/authorize` 授权确认页面
   - ✅ Token 端点扩展支持 `authorization_code` grant type
   - ✅ PKCE 支持（code_challenge, code_verifier）
2. ✅ OAuth tokens 表扩展（grant_type, refresh_token_hash 字段）

✅ **版本管理已完成**（2026-09-22）：
- ✅ 多版本并存与回滚功能已实现
- ✅ Provider 可发布新版本、设置当前版本、撤回版本
- ✅ 用户/Agent 可下载特定版本（默认为当前版本）
- ✅ Downloads/Installs 记录实际获取的版本

🚧 **P2+ 功能标记为未来迭代**：
- ❌ 深度链接一键安装（需协议注册 `cursor://install-skill?url=...`）
- ❌ Refresh Token 机制（access_token 自动刷新）

---

## 目录

1. [目标与非目标](#1-目标与非目标)
2. [核心变更：登录必需 + Agent OAuth](#2-核心变更登录必需--agent-oauth)
3. [下载列表 vs 安装列表](#3-下载列表-vs-安装列表)
4. [Skill 包内容契约](#4-skill-包内容契约)
5. [端到端用户旅程](#5-端到端用户旅程)
6. [认证授权矩阵](#6-认证授权矩阵)
7. [Agent OAuth 流程设计](#7-agent-oauth-流程设计)
8. [安全考量](#8-安全考量)
9. [Gap 分析：现状 vs 目标](#9-gap-分析现状-vs-目标)
10. [UX 线框图](#10-ux-线框图)
11. [实现批次](#11-实现批次)
12. [验收标准](#12-验收标准)
13. [相关文档](#13-相关文档)

---

## 1. 目标与非目标

### 1.1 目标

1. **下载 + 安装追踪**：用户在 Dashboard 可查看「我的下载」列表和「我的安装」列表，清晰了解已获取和已部署的 Skills
2. **深度链接回溯**：每个已下载/已安装的 Skill 包内嵌回链（OpenMCP skill 详情页、安装文档、市场 URL、作者页），用户和 Agent 均可追溯来源
3. **全面登录要求**：**所有** Skill 获取、下载、安装路径均需用户登录，取消匿名 `/package` 路径；对齐 acquire/Store MCP 的统一授权流
4. **Agent OAuth 集成**：当 Agent（通过 Store MCP / install prompt）需要认证时，用户可在 Agent 内完成 OAuth 授权流程（对接 OpenMCP better-auth），或通过浏览器跳转完成，**不仅限于粘贴 API Key**
5. **多源支持保持**：继续支持 GitHub 仓库、ZIP 上传文件、SKILL.md 标准包三种源类型
6. **授权控制**：免费 Skill 需登录获取；付费 Skill 需先购买授权（entitlement）后才能下载/安装
7. **统一安装渠道**：整合详情页、`/install/openmcp.md`、Store MCP 三个入口，确保体验一致

### 1.2 非目标

- ❌ **自动安装**：不在浏览器端直接写入用户本地文件系统（需用户手动解压到 skills 目录，或 Agent 代为操作）
- ❌ **Provider 直连**：MCP / A2A 仅走平台网关，不支持 Provider 私有端点安装
- ❌ **深度集成 IDE**：深度一键安装（如自动修改 Cursor `mcp.json`）标记为 P2+ 未来迭代

---

## 2. 核心变更：登录必需 + Agent OAuth

### 2.1 新要求 1：登录必需（Login-Required Everywhere）

#### 原有模式（v1.0，已废弃）

- 免费 Skill 的 `/api/skills/[id]/package` 端点**可匿名访问**
- Agent 可直接下载免费 Skill 包，无需用户登录
- 仅 `skills.acquire`（tRPC）和 `/download` 强制登录

#### 新模式（v2.0，本设计）

- **所有** Skill 获取、下载、安装操作**必须登录**：
  - `skills.acquire`（tRPC）：登录 ✅
  - `/api/skills/[id]/download`：登录 ✅
  - `/api/skills/[id]/package`：登录 ✅（**新增**）
  - Store MCP `install_asset`：登录 ✅（**新增**）
- 匿名用户**只能**浏览市场列表和详情页，**无法**触发任何下载/安装
- 付费 Skill 额外要求 `entitlement`（已购买授权）

#### 目的

1. **统一用户体验**：避免「Web 需登录、Agent 可匿名」的割裂
2. **准确计数与追踪**：所有下载/安装均记录 `userId`，可生成「我的下载」列表
3. **安全与合规**：平台可审计每个用户的 Skill 使用情况，符合付费授权模型

---

### 2.2 新要求 2：Agent OAuth 支持

#### 当前模式（v1.0）

- Agent 安装 Skill 或 Store MCP 时，需用户手动到 Dashboard 生成 API Key（`sk-...`，网关虚拟 Key），复制粘贴到 Agent 配置中；该 Key 同时可用于平台网关 MCP / A2A 调用
- 仅支持 **Bearer Token 认证**（API Key）

#### 新模式（v2.0，本设计）

- Agent（通过 Store MCP / install prompt）需要认证时，支持 **OAuth 授权流程**：
  1. **Device Code Flow**：Agent 显示 6 位码 + 链接，用户在浏览器打开链接并输入码完成授权，Agent 轮询换取 token
  2. **Authorization Code Flow（Browser Redirect）**：Agent 打开浏览器跳转到 OpenMCP OAuth 页面，用户登录后回调到 Agent（需协议注册如 `cursor://oauth-callback?code=...`）
- OAuth 流程对接 **better-auth**（OpenMCP 现有身份系统）
- **API Key 作为回退方案保留**：高级用户或无法完成 OAuth 的环境（如纯命令行）仍可手动粘贴 API Key

#### OAuth vs Store MCP 上游工具 OAuth（Mode①）

| 项 | Platform Login OAuth（本节设计） | MCP Upstream Tool OAuth（Mode①） |
|----|----------------------------------|-----------------------------------|
| **目的** | 用户登录 **OpenMCP 平台** 身份认证 | Provider 授权 Agent 调用 **上游 MCP 工具**（如 GitHub API） |
| **流程** | Agent → OpenMCP better-auth → 获取平台 access token | Agent → Provider MCP → 跳转 Provider OAuth（如 GitHub） → 回调 Provider |
| **Scope** | 用户在 OpenMCP 的钱包、entitlements、API 访问 | 上游服务（GitHub repos、Linear issues 等） |
| **实现位置** | `/api/mcp/store` + Store MCP handler | Provider MCP 服务端（由 Provider 实现，平台不参与） |
| **文档** | 本设计稿 §7 | [PROVIDER_OAUTH_MODE1.md](./PROVIDER_OAUTH_MODE1.md) |

**关键**：Platform Login OAuth（本节）是 Agent 取得 OpenMCP 身份凭证的方式；Mode① OAuth 是 Provider 让 Agent 调用上游服务的方式。两者独立，分别配置。

---

## 3. 下载列表 vs 安装列表

### 3.1 定义

| 列表 | 数据来源 | 记录条件 | 状态 | UI 入口 |
|------|---------|---------|------|---------|
| **我的下载（Downloads）** | `skill_downloads` 表 | 用户首次调用 `skills.acquire` 成功（无论是否实际下载文件） | `downloaded`（固定） | Dashboard `/dashboard/skills/downloads` |
| **我的安装（Installs）** | `skill_installs` 表（**新增**） | Agent 安装到本地成功后回调平台 API 写入记录 | `active` / `removed` | Dashboard `/dashboard/skills/installs` |

### 3.2 数据模型

#### `skill_downloads` 表（已存在，扩展）

```sql
CREATE TABLE skill_downloads (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  -- 新增字段
  status TEXT DEFAULT 'downloaded', -- 固定 'downloaded'（未来可扩展 'failed'）
  skill_version TEXT,                -- 下载时的 skills.version
  skill_title TEXT,                  -- 冗余存储标题（防止 skill 删除后无法显示）
  skill_slug TEXT,
  UNIQUE(user_id, skill_id)          -- 每用户每 skill 仅一条记录
);
```

#### `skill_installs` 表（**新增**）

```sql
CREATE TABLE skill_installs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  runtime TEXT NOT NULL,             -- 'cursor' | 'claude-code' | 'codex' | 'generic'
  install_path TEXT,                 -- 本地安装路径（如 ~/.cursor/skills/dev-expert/）
  status TEXT DEFAULT 'active',      -- 'active' | 'removed'
  installed_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,            -- Agent 调用时可更新（可选）
  skill_version TEXT,                -- 安装时的 skills.version
  skill_title TEXT,                  -- 冗余存储
  skill_slug TEXT,
  UNIQUE(user_id, skill_id, runtime) -- 每用户每 skill 每 runtime 仅一条 active 记录
);
```

#### 字段说明

- **`status`**：
  - `skill_downloads.status`：固定 `downloaded`（未来可能有 `failed`）
  - `skill_installs.status`：`active`（已安装）/ `removed`（用户卸载或 Agent 报告移除）
- **冗余字段**（`skill_title`, `skill_slug`, `skill_version`）：skill 被删除或下架后，用户仍可在列表中看到历史记录
- **`runtime`**：区分不同 IDE 的安装实例（用户可能在 Cursor 和 Claude Code 同时安装同一 Skill）

---

### 3.3 列表 UI 设计

#### 我的下载（`/dashboard/skills/downloads`）

- **列展示**：Skill 标题、版本、下载时间、操作
- **操作**：
  - 「再次下载」→ 调用 `/api/skills/[id]/package`（`?count=0` 不重复计数）
  - 「查看详情」→ 跳转 `/skills/[id]`（如果 skill 已删除则显示 404 提示）
  - 「安装」→ 显示安装指引（同详情页 `SkillInstallPanel`）
- **筛选**：按时间、Skill 类型（sourceType）、免费/付费
- **deeplink**：每行可点击跳转回原 skill 详情页（如果仍存在）

#### 我的安装（`/dashboard/skills/installs`）

- **列展示**：Skill 标题、版本、Runtime、状态（active/removed）、安装时间、最后使用时间
- **操作**：
  - 「卸载」→ 将 `status` 改为 `removed`（实际删除文件需用户或 Agent 手动操作）
  - 「重新安装」→ 显示安装指引
  - 「查看详情」→ 跳转 `/skills/[id]`
- **筛选**：按 Runtime、状态、时间
- **deeplink**：同上

---

### 3.4 记录写入时机

| 表 | 写入时机 | API 端点 |
|----|---------|----------|
| `skill_downloads` | 用户首次调用 `skills.acquire` 成功 | `skills.acquire` tRPC + `skills.downloads++` |
| `skill_installs` | Agent 安装到本地成功后，调用平台回调 API | **新增** `POST /api/skills/[id]/install-callback`（需登录） |

#### 新增端点：`/api/skills/[id]/install-callback`

```typescript
// POST /api/skills/[id]/install-callback
// Body: { runtime, installPath, skillVersion }
// Auth: session (userId)
// 逻辑：
//   1. 校验 userId 已登录
//   2. 校验 skillId 存在
//   3. upsert skill_installs（user+skill+runtime unique）
//   4. 返回 { success: true, installId }
```

**调用方**：

- Agent（通过 Store MCP `install_asset` 或手动安装后）
- Cursor / Claude Code Extension（未来深度集成时自动回调）
- 用户手动解压后，可访问 `/dashboard/skills/installs` 手动标记「已安装」

---

## 4. Skill 包内容契约

### 4.1 目标

每个已下载/已安装的 Skill 包必须内嵌 **回溯链接**，方便：

1. 用户（手动解压后）知道 Skill 来自哪里，如何查看文档和更新
2. Agent（读取 SKILL.md）可向用户展示链接，或提示更新

### 4.2 SKILL.md Frontmatter 新增字段

在现有 SKILL.md 标准（SkillHub 兼容）基础上，**新增** `openmcp` 字段块：

```yaml
---
name: dev-expert
version: 1.0.0
description: AI-powered development expert
platforms: [cursor, claude-code, codex]
# ... 其他标准字段 ...

# ===== 新增 OpenMCP 专属元数据 =====
openmcp:
  # Skill 详情页 URL（用户可点击回到市场）
  skillUrl: https://www.openmcp.cn/skills/cm2xyz123
  # Skill slug（方便 Agent 检查更新）
  slug: dev-expert
  # 安装文档 URL（Agent 安装指引）
  installDocUrl: https://www.openmcp.cn/install/openmcp.md
  # 市场首页 URL
  marketplaceUrl: https://www.openmcp.cn/skills
  # 作者页 URL（如果 Provider 有公开主页）
  authorUrl: https://www.openmcp.cn/providers/github-alice
  # 作者名称
  authorName: Alice
  # Skill ID（内部 UUID）
  skillId: cm2xyz123
  # 下载时间戳（ISO 8601）
  downloadedAt: 2026-09-22T06:28:00Z
  # 用户 ID（可选，隐私考量）
  # userId: user_abc123
---

# Dev Expert

...（Skill 正文）
```

#### 字段说明

| 字段 | 必需 | 说明 |
|------|------|------|
| `openmcp.skillUrl` | ✅ | Skill 详情页完整 URL（含域名），用户点击可回到市场 |
| `openmcp.slug` | ✅ | Skill slug（唯一标识符），Agent 可用于检查更新 |
| `openmcp.installDocUrl` | ✅ | 安装文档 URL（通常为 `/install/openmcp.md`） |
| `openmcp.marketplaceUrl` | ✅ | 市场首页 URL |
| `openmcp.authorUrl` | ⚠️ | 作者页 URL（如果 Provider 有公开主页；无则省略） |
| `openmcp.authorName` | ⚠️ | 作者名称 |
| `openmcp.skillId` | ✅ | Skill 内部 UUID |
| `openmcp.downloadedAt` | ✅ | 下载时间戳（ISO 8601） |
| `openmcp.userId` | ❌ | 用户 ID（可选，隐私敏感，建议省略） |

---

### 4.3 生成逻辑（`buildSkillPackage`）

在 `src/lib/agent-install/skill-package.ts` 的 `buildSkillPackage` 函数中：

1. 读取 `skills` 记录（id, slug, title, version, authors, ...）
2. 构造 `openmcp` 字段块：
   - `skillUrl = ${NEXT_PUBLIC_APP_BASE_URL}/skills/${skill.id}`
   - `slug = skill.slug`
   - `installDocUrl = ${NEXT_PUBLIC_APP_BASE_URL}/install/openmcp.md`
   - `marketplaceUrl = ${NEXT_PUBLIC_APP_BASE_URL}/skills`
   - `authorUrl = ${NEXT_PUBLIC_APP_BASE_URL}/providers/${skill.authors[0]?.id}` （如果有）
   - `authorName = skill.authors[0]?.name`
   - `skillId = skill.id`
   - `downloadedAt = new Date().toISOString()`
3. 将 `openmcp` 块插入 YAML frontmatter
4. 生成 SKILL.md 文件，打包为 ZIP

#### 代码锚点

- `src/lib/agent-install/skill-package.ts`：`buildSkillPackage` 函数
- `src/lib/agent-install/types.ts`：`SkillPackageMetadata` 类型（扩展 `openmcp` 字段）

---

### 4.4 非 SKILL.md 包的处理

| 源类型 | 处理方式 |
|--------|---------|
| **GitHub** | 仍返回 `{ kind: 'github', githubUrl, installNotes }`；**额外生成** 最小 SKILL.md 包（仅含元数据 + `openmcp` 块），作为 `.openmcp-meta.md` 附加文件（可选，P1） |
| **sourceFiles ZIP** | 打包时在 ZIP 根目录插入 `.openmcp-meta.md`（含 `openmcp` 块） |
| **SKILL.md 标准包** | 直接在 SKILL.md 中内嵌 `openmcp` 块（主流推荐） |

---

## 5. 端到端用户旅程

### 5.1 Web 浏览器流程

```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐       ┌─────────────┐
│  1. 浏览市场  │ ────> │  2. 查看详情  │ ────> │ 3. 登录 + 授权 │ ────> │ 4. 下载安装  │
│  /skills    │       │  /skills/[id] │       │ 免费 / 付费   │       │ ZIP / GitHub│
└─────────────┘       └──────────────┘       └──────────────┘       └─────────────┘
      ↓                       ↓                      ↓                       ↓
   筛选 / 搜索            信任信号              强制登录               记录到 Downloads
   certified          securityGrade          skills.acquire         解压 → Installs
   priceType           riskWarning           entitlements           回调 install-callback
```

#### 步骤 1：浏览市场

- **入口**：`/skills`、`/start`、搜索框
- **过滤**：`status=published` only；按 `priceType`（free/paid）、`certified`、分类、排序
- **信息**：标题、作者、价格、`downloads`、`securityGrade` 徽标
- **匿名可见**：✅ 列表和详情页 HTML 可匿名浏览

#### 步骤 2：查看详情

- **详情页**：`/skills/[id]`
- **展示内容**：
  - README（`skills.readme` / `readmeEn`）
  - 元数据：`version`、`platforms`、`securityGrade`、`certified`
  - 信任信号：安全报告摘要（`securityLlmAnalysis.riskSummary`）
  - 价格与授权状态（已购 / 未购）
- **CTA 区域**：
  - `SkillPurchase`：免费获取 / 立即购买 / 立即获取（已购）
  - `SkillInstallPanel`：复制 prompt / 下载 ZIP / 本地安装指引

#### 步骤 3：登录 + 获取授权

##### 免费 Skill

1. 用户点击「免费获取」（`SkillPurchase` 组件）
2. **强制登录**：
   - 如果未登录，弹出登录对话框（better-auth）
   - 登录后调用 `skills.acquire`（`protectedProcedure`）
3. 服务端：
   - 校验 `status=published`
   - 写入 `skill_downloads` 记录（userId + ipAddress + userAgent + skill metadata）
   - `skills.downloads++`
   - 返回交付物（GitHub URL / files 数组 + downloadUrl + packageUrl）
4. 用户看到「获取成功」对话框，可下载 ZIP 或查看 GitHub URL

##### 付费 Skill

1. 未购：点击「立即购买」
   - 调用 `skills.createPurchase`（需登录）
   - 扣除 `balances.amount`（CNY 钱包）
   - 写入 `skill_entitlements`（userId + skillId + orderId）
   - 余额不足 → `needRecharge=true`，引导到 `/dashboard/recharge`
2. 已购：点击「立即获取」
   - 校验 `skill_entitlements` 存在
   - 调用 `skills.acquire`（同免费流程）

#### 步骤 4：下载安装

##### 方式 A：SkillPurchase 对话框（acquire 后）

- **GitHub 类型**：
  - 显示 `githubUrl`（可复制）
  - `installNotes`：`git clone <url>`
- **files 类型**：
  - 显示文件列表（`files[].path`）
  - 「下载 ZIP」按钮 → 打开 `downloadUrl`（`/api/skills/[id]/download?count=0`，已计数则不重复）

##### 方式 B：SkillInstallPanel（详情页侧栏）

1. **复制 prompt**（推荐）：
   - 短提示词：`请根据 https://www.openmcp.cn/install/openmcp.md，安装 <slug>。`
   - Agent 自动读取 `/install/openmcp.md` → 调用 `/api/skills/<slug>/package`（**需登录**） → 解压到 skills/
2. **下载 Zip 包安装**：
   - 调用 `/api/skills/[id]/package`（**需登录**；付费需 entitlement）
   - 返回 SKILL.md 标准包（ZIP，含 `openmcp` 元数据块）
3. **安装到本地 Agent**（折叠面板）：
   - Runtime tabs（Cursor / Claude Code / Codex / Generic）
   - 显示目标目录：`~/.cursor/skills/<slug>/`
   - 步骤指引：下载 → 解压 → **回调平台** → 重载会话

##### 回调平台记录安装

- 用户解压 ZIP 到 `~/.cursor/skills/<slug>/` 后，**可选操作**：
  1. 访问 `/dashboard/skills/installs`，点击「标记已安装」（手动）
  2. Agent（Store MCP 或未来 Extension）自动调用 `POST /api/skills/[id]/install-callback`（自动）
- 记录写入 `skill_installs` 表（user + skill + runtime）

---

### 5.2 Agent 驱动流程（Store MCP + OAuth）

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐       ┌─────────────┐
│  1. 注册 Store│ ────> │ 2. 搜索 Skill │ ────> │ 3. OAuth 登录 │ ────> │ 4. 安装 Skill│
│     MCP      │       │  search_assets│       │  Device Code  │       │install_asset│
└──────────────┘       └──────────────┘       └──────────────┘       └─────────────┘
      ↓                       ↓                      ↓                       ↓
   配置 mcp.json          查看详情              换取 token               解压 + 回调
   SKIP Bearer          get_asset             openmcp.cn/device      install-callback
```

#### 步骤 1：注册 Store MCP

- **首次配置**（可省略 Bearer，改用 OAuth）：
  - Cursor `mcp.json`：
    ```json
    {
      "mcpServers": {
        "openmcp-store": {
          "url": "https://www.openmcp.cn/api/mcp/store",
          "authMode": "oauth",
          "deviceCodeUrl": "https://www.openmcp.cn/api/mcp/store/oauth/device",
          "tokenUrl": "https://www.openmcp.cn/api/mcp/store/oauth/token"
        }
      }
    }
    ```
  - 或仍可使用 `Bearer <API_KEY>`（回退方案）

#### 步骤 2：搜索 Skill

- Agent 调用 `search_assets`（q, kind=skill, limit）
- 返回已发布 Skill 列表（id, title, slug, version, price, securityGrade）
- Agent 调用 `get_asset`（kind=skill, id=<slug>）查看详情

#### 步骤 3：OAuth 登录（首次或 Token 过期）

- Agent 调用 `install_asset`，Store MCP 检测到未登录或 Token 过期
- **Device Code Flow**（推荐）：
  1. Store MCP 调用 `/api/mcp/store/oauth/device` 生成 `device_code` 和 `user_code`
  2. 返回给 Agent：
     ```json
     {
       "error": "authentication_required",
       "device_code": "abc123...",
       "user_code": "ABCD-1234",
       "verification_uri": "https://www.openmcp.cn/device",
       "expires_in": 600
     }
     ```
  3. Agent 向用户展示：
     ```
     请在浏览器打开 https://www.openmcp.cn/device
     并输入代码：ABCD-1234
     ```
  4. 用户在浏览器完成登录 + 授权，平台标记 `device_code` 为已授权
  5. Agent 轮询 `/api/mcp/store/oauth/token`（POST `{ device_code }`）直到返回 `access_token`
  6. Agent 保存 `access_token`（有效期如 30 天），后续请求带 `Authorization: Bearer <token>`

- **Authorization Code Flow（可选，P2）**：
  1. Agent 打开浏览器跳转到 `/api/mcp/store/oauth/authorize?client_id=...&redirect_uri=cursor://oauth-callback`
  2. 用户登录 + 授权，平台回调 `cursor://oauth-callback?code=xyz`
  3. Agent 监听协议回调，POST `/api/mcp/store/oauth/token` 换取 `access_token`

#### 步骤 4：安装 Skill

- Agent 调用 `install_asset`（kind=skill, id=<slug>, runtime=cursor）+ `Authorization: Bearer <token>`
- 服务端：
  - 解析 token，获取 `userId`
  - 校验付费 Skill 的 `entitlement`（同 tRPC `skills.acquire`）
  - 调用 `acquireSkill`（与 Web 流程共享逻辑，写入 `skill_downloads`）
  - 返回 SKILL.md 包内容（JSON 格式：`{ files: [{ path, content }], targetDir }` 或 ZIP base64）
- Agent 解压到本地 `~/.cursor/skills/<slug>/`
- Agent **自动回调** `POST /api/skills/[slug]/install-callback`（runtime=cursor, installPath）
- 记录写入 `skill_installs` 表
- 用户访问 Dashboard `/dashboard/skills/installs` 可看到新安装记录

---

## 6. 认证授权矩阵

### 6.1 Web 端点（Session Cookie）

| 场景 | API 端点 | 是否需登录 | 是否需授权 | 计数规则 |
|------|---------|-----------|-----------|---------|
| **浏览列表/详情** | `GET /skills`, `GET /skills/[id]` | ❌ 否 | ❌ 否 | ❌ 不计数 |
| **免费 Skill · acquire（首次）** | `skills.acquire` tRPC | ✅ **是** | ❌ 否 | ✅ 写入 `skill_downloads`、`downloads++` |
| **免费 Skill · 下载 ZIP** | `/api/skills/[id]/download` | ✅ **是** | ❌ 否 | `?count=1` 时计数（默认 acquire 已计数，传 `0`） |
| **免费 Skill · 包下载（package）** | `/api/skills/[id]/package` | ✅ **是（NEW）** | ❌ 否 | ❌ 不计数 |
| **付费 Skill · acquire（首次）** | `skills.acquire` | ✅ 是 | ✅ **需 entitlement** | ✅ 写入 `skill_downloads`、`downloads++` |
| **付费 Skill · 下载 ZIP** | `/api/skills/[id]/download` | ✅ 是 | ✅ 需 entitlement | `?count=1` 时计数 |
| **付费 Skill · 包下载（package）** | `/api/skills/[id]/package` | ✅ 是 | ✅ 需 entitlement | ❌ 不计数 |
| **标记已安装** | `/api/skills/[id]/install-callback` | ✅ 是 | ❌ 否 | ❌ 不计数（仅记录安装） |

---

### 6.2 Agent 端点（Bearer Token / OAuth）

| 场景 | API 端点 | 认证方式 | 是否需授权 | 计数规则 |
|------|---------|---------|-----------|---------|
| **Store MCP · 搜索** | `/api/mcp/store` `search_assets` | ⚠️ **可选**（匿名可搜索已发布） | ❌ 否 | ❌ 不计数 |
| **Store MCP · 查看详情** | `/api/mcp/store` `get_asset` | ⚠️ **可选** | ❌ 否 | ❌ 不计数 |
| **Store MCP · 安装免费** | `/api/mcp/store` `install_asset` | ✅ **OAuth / Bearer（NEW）** | ❌ 否 | ✅ 写入 `skill_downloads`、`downloads++` |
| **Store MCP · 安装付费** | `/api/mcp/store` `install_asset` | ✅ **OAuth / Bearer** | ✅ 需 entitlement | ✅ 写入 `skill_downloads`、`downloads++` |
| **Agent 回调安装** | `/api/skills/[id]/install-callback` | ✅ OAuth / Bearer | ❌ 否 | ❌ 不计数（仅记录安装） |

#### 认证方式说明

- **Session Cookie**：Web 端，better-auth 自动处理，`userId` 来自 `ctx.session.user.id`
- **Bearer Token（API Key）**：Agent 端，`Authorization: Bearer sk-...` 或 `x-litellm-api-key: sk-...`，SHA-256 哈希比对 `api_keys.key`，获取 `userId`。**该 Key 由 Dashboard 代理 LiteLLM 签发**（Virtual Key，同一把可用于平台网关），见 [API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)
- **OAuth（NEW）**：Agent 端，Device Code / Authorization Code Flow，换取 `access_token`，JWT 解析获取 `userId`

---

### 6.3 授权边界变更对比

| 项 | v1.0（原有） | v2.0（本设计） | 变更原因 |
|----|-------------|---------------|---------|
| **免费 Skill `/package` 匿名** | ✅ 允许 | ❌ **禁止** | 统一体验，准确追踪下载用户 |
| **Store MCP `install_asset` 免费** | ⚠️ 可匿名（文档不一致） | ✅ **必须登录** | 对齐 acquire 逻辑，记录 `skill_downloads` |
| **Agent 认证方式** | 仅 Bearer（API Key） | Bearer **+ OAuth** | 降低手动粘贴门槛，提升 UX |

---

## 7. Agent OAuth 流程设计

### 7.1 流程选型

#### 选项 A：Device Code Flow（**推荐 P0**）

- **优点**：
  - ✅ 无需协议注册（`cursor://` 回调），适用所有 IDE
  - ✅ 用户体验简单：看到 6 位码 → 浏览器输入 → 完成授权
  - ✅ 安全性高：`device_code` 和 `user_code` 分离，防止钓鱼
- **缺点**：
  - ⚠️ 需轮询（每 5s 查询一次，直到授权或超时）

#### 选项 B：Authorization Code Flow（Browser Redirect）

- **优点**：
  - ✅ 无需轮询，授权后立即回调
  - ✅ 标准 OAuth 2.0 流程，生态兼容性好
- **缺点**：
  - ❌ 需 IDE 支持协议注册（`cursor://oauth-callback`），依赖 Cursor / Claude Desktop 更新
  - ❌ 实现复杂度高

**决策**：P0 优先实现 **Device Code Flow**；P2 可扩展 Authorization Code Flow。

---

### 7.2 Device Code Flow 详细步骤

#### 角色

- **Agent**：Cursor / Claude Desktop / 命令行 Agent（MCP 客户端）
- **User**：开发者，操作浏览器
- **Platform**：OpenMCP better-auth + OAuth 服务

#### 流程图

```
┌──────┐                 ┌──────────┐                 ┌──────────┐
│ Agent│                 │  User    │                 │ Platform │
└──┬───┘                 └────┬─────┘                 └────┬─────┘
   │                          │                            │
   │ 1. POST /oauth/device    │                            │
   ├─────────────────────────────────────────────────────>│
   │                          │                            │
   │ 2. { device_code, user_code, verification_uri }       │
   │<──────────────────────────────────────────────────────┤
   │                          │                            │
   │ 3. 展示 user_code + URL  │                            │
   ├────────────────────────>│                            │
   │   "打开 openmcp.cn/device 输入 ABCD-1234"            │
   │                          │                            │
   │                          │ 4. 访问 /device            │
   │                          ├──────────────────────────>│
   │                          │                            │
   │                          │ 5. 登录 + 输入 user_code   │
   │                          ├──────────────────────────>│
   │                          │                            │
   │                          │ 6. 授权确认页              │
   │                          │<───────────────────────────┤
   │                          │   "允许 Cursor 访问..."     │
   │                          │                            │
   │                          │ 7. 点击「授权」            │
   │                          ├──────────────────────────>│
   │                          │                            │
   │                          │ 8. 授权成功页              │
   │                          │<───────────────────────────┤
   │                          │   "已授权，可关闭此页"      │
   │                          │                            │
   │ 9. 轮询 POST /oauth/token│                            │
   ├─────────────────────────────────────────────────────>│
   │   { device_code }        │                            │
   │                          │                            │
   │ 10. { access_token, expires_in }                      │
   │<──────────────────────────────────────────────────────┤
   │                          │                            │
   │ 11. 保存 token           │                            │
   │ 后续请求带 Bearer <token>│                            │
   └──────────────────────────┴────────────────────────────┘
```

---

### 7.3 API 端点设计

#### `POST /api/mcp/store/oauth/device`

- **请求**：
  ```json
  {
    "client_id": "openmcp-store",
    "scope": "skills:read skills:install"
  }
  ```
- **响应**：
  ```json
  {
    "device_code": "abc123...",
    "user_code": "ABCD-1234",
    "verification_uri": "https://www.openmcp.cn/device",
    "verification_uri_complete": "https://www.openmcp.cn/device?user_code=ABCD-1234",
    "expires_in": 600,
    "interval": 5
  }
  ```
- **逻辑**：
  1. 生成 `device_code`（32 字节随机，SHA-256 存储）
  2. 生成 `user_code`（6 位大写字母+数字，格式如 `ABCD-1234`）
  3. 写入 `oauth_device_codes` 表（device_code, user_code, client_id, scope, expires_at, status='pending'）
  4. 返回上述字段

#### `GET /device`

- **页面**：用户输入 `user_code`
- **逻辑**：
  1. 校验 `user_code` 存在且未过期
  2. 如果未登录，跳转到 better-auth 登录页（`/sign-in?redirect=/device?user_code=...`）
  3. 登录后显示授权确认页：
     ```
     授权请求

     应用：OpenMCP Store MCP
     权限：
       - 查看和安装 Skills
       - 访问您的下载和安装列表

     [ 拒绝 ]  [ 授权 ]
     ```
  4. 用户点击「授权」→ POST `/api/mcp/store/oauth/authorize`
  5. 服务端：
     - 标记 `oauth_device_codes.status = 'authorized'`
     - 绑定 `userId`
  6. 显示「授权成功，可关闭此页」

#### `POST /api/mcp/store/oauth/token`

- **请求**：
  ```json
  {
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    "device_code": "abc123...",
    "client_id": "openmcp-store"
  }
  ```
- **响应**（授权完成）：
  ```json
  {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 2592000,
    "scope": "skills:read skills:install"
  }
  ```
- **响应**（授权待处理）：
  ```json
  {
    "error": "authorization_pending"
  }
  ```
- **响应**（已拒绝）：
  ```json
  {
    "error": "access_denied"
  }
  ```
- **响应**（已过期）：
  ```json
  {
    "error": "expired_token"
  }
  ```
- **逻辑**：
  1. 查询 `oauth_device_codes` 表（device_code）
  2. 校验 `expires_at`，过期则返回 `expired_token`
  3. 如果 `status='pending'`，返回 `authorization_pending`（Agent 继续轮询）
  4. 如果 `status='denied'`，返回 `access_denied`
  5. 如果 `status='authorized'`：
     - 生成 JWT `access_token`（payload: `{ userId, clientId, scope }`，签名密钥 `JWT_SECRET`，过期时间 30 天）
     - 写入 `oauth_tokens` 表（token SHA-256 哈希, userId, expires_at）
     - 返回 `access_token`

---

### 7.4 数据模型

#### `oauth_device_codes` 表（**新增**）

```sql
CREATE TABLE oauth_device_codes (
  id TEXT PRIMARY KEY,
  device_code TEXT UNIQUE NOT NULL,      -- SHA-256 哈希存储
  user_code TEXT UNIQUE NOT NULL,        -- 明文存储（6 位短码）
  client_id TEXT NOT NULL,               -- 'openmcp-store'
  scope TEXT,                             -- 'skills:read skills:install'
  status TEXT DEFAULT 'pending',         -- 'pending' | 'authorized' | 'denied'
  user_id TEXT REFERENCES users(id),     -- 授权后绑定
  expires_at TIMESTAMP NOT NULL,         -- 通常 10 分钟
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### `oauth_tokens` 表（**新增**）

```sql
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,       -- access_token 的 SHA-256 哈希
  user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  scope TEXT,
  expires_at TIMESTAMP NOT NULL,         -- 通常 30 天
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### 7.5 Agent 侧实现（Store MCP）

在 `src/lib/agent-install/store-mcp/auth.ts` 中：

```typescript
// NEW: OAuth Device Code Flow
export async function initiateDeviceCodeFlow() {
  const res = await fetch(`${API_BASE}/api/mcp/store/oauth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'openmcp-store', scope: 'skills:read skills:install' })
  });
  const data = await res.json();
  return data; // { device_code, user_code, verification_uri, expires_in, interval }
}

export async function pollForToken(deviceCode: string): Promise<string> {
  let attempts = 0;
  const maxAttempts = 120; // 10 分钟超时（每 5s 一次）
  while (attempts < maxAttempts) {
    await sleep(5000);
    const res = await fetch(`${API_BASE}/api/mcp/store/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: 'openmcp-store'
      })
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') {
      attempts++;
      continue;
    }
    throw new Error(data.error || 'Unknown error');
  }
  throw new Error('Timeout waiting for authorization');
}
```

在 `install_asset` 工具中：

```typescript
export async function install_asset(args: { kind, id, runtime }, auth?: string) {
  let token = auth; // Bearer token from config
  if (!token) {
    // 触发 Device Code Flow
    const deviceFlow = await initiateDeviceCodeFlow();
    console.log(`请在浏览器打开 ${deviceFlow.verification_uri} 并输入代码：${deviceFlow.user_code}`);
    token = await pollForToken(deviceFlow.device_code);
    // 保存 token 到 Agent 本地配置（Cursor settings / Claude config）
  }
  // 调用 API 安装 Skill
  const res = await fetch(`${API_BASE}/api/skills/${args.id}/package`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  // ...
}
```

---

### 7.6 UX 线框图

#### Agent 侧提示

```
Agent: 正在安装 Skill "dev-expert"...

需要登录 OpenMCP 以继续安装。

请在浏览器打开以下链接并输入代码：

  https://www.openmcp.cn/device

  代码：ABCD-1234

等待授权...（将在 10 分钟内过期）
```

#### Web 授权页（`/device`）

```
┌────────────────────────────────────────────┐
│  OpenMCP · 设备授权                        │
├────────────────────────────────────────────┤
│                                            │
│  请输入显示在您的设备上的代码：            │
│                                            │
│  ┌──────────────┐                         │
│  │ ABCD-1234    │  [继续]                 │
│  └──────────────┘                         │
│                                            │
└────────────────────────────────────────────┘

（用户点击「继续」后）

┌────────────────────────────────────────────┐
│  授权请求                                  │
├────────────────────────────────────────────┤
│                                            │
│  应用：OpenMCP Store MCP                   │
│  发起设备：Cursor (macOS)                  │
│                                            │
│  该应用请求以下权限：                      │
│  ✓ 查看和搜索 Skills                       │
│  ✓ 安装 Skills 到您的设备                 │
│  ✓ 访问您的下载和安装列表                 │
│                                            │
│  [ 拒绝 ]  [ 授权 ]                       │
│                                            │
└────────────────────────────────────────────┘

（授权成功后）

┌────────────────────────────────────────────┐
│  授权成功 ✓                                │
├────────────────────────────────────────────┤
│                                            │
│  您已成功授权 OpenMCP Store MCP。          │
│  现在可以关闭此页面，返回您的设备继续操作。│
│                                            │
└────────────────────────────────────────────┘
```

---

## 8. 安全考量

### 8.1 用户侧风险提示

| 安全等级 | `securityGrade` | 用户体验 |
|---------|----------------|---------|
| **safe** | `safe` | 绿色徽标，正常下载 |
| **caution** | `caution` | ⚠️ 黄色徽标 + 风险摘要（`securityLlmAnalysis.riskSummary` 或 flags 计数）；**仍可下载**，但弹窗提示 |
| **malware** | `rejected` | ❌ **不上架**，用户不可见 |

### 8.2 OAuth 安全

| 项 | 措施 |
|----|------|
| **device_code 存储** | SHA-256 哈希存储，防止泄露后被滥用 |
| **user_code 格式** | 6 位大写字母+数字（如 `ABCD-1234`），易读易输入，防止钓鱼 |
| **过期时间** | `device_code` 10 分钟过期，`access_token` 30 天过期（可刷新，P2） |
| **轮询频率限制** | Agent 每 5s 轮询一次，服务端限制同一 `device_code` 每 5s 最多查询一次（防止 DDoS） |
| **Scope 最小化** | 仅授予 `skills:read skills:install`，不包括钱包操作或敏感数据读取 |
| **HTTPS 强制** | 所有 OAuth 端点强制 HTTPS，防止中间人攻击 |

### 8.3 Provider 密钥隔离

- ❌ **禁止**：在 Skill 包中嵌入 Provider 的 API Key / 私有端点
- ✅ **仅平台网关**：MCP / A2A 安装时，返回的配置**仅包含**平台网关 URL（`https://api.openmcp.cn/{serverName}/mcp`）+ 用户自己的 API Key / OAuth Token
- ✅ **Skill 文件隔离**：SKILL.md 包中仅含开源代码或 Provider 明确公开的资源；不得泄露 Provider 凭证

---

## 9. Gap 分析：现状 vs 目标

### 9.1 已实现（✅）

| 项 | 路径 | 说明 |
|----|------|------|
| Provider 发布 | `src/app/[locale]/(dashboard)/dashboard/skills/new/` | GitHub / ZIP 上传 → 扫描 → 上架 |
| 免费获取 | `src/web/skills/acquire.ts`、`SkillPurchase` | tRPC `skills.acquire` → 计数 → 返回 GitHub / files |
| 付费购买 | `src/web/skills/purchase.ts`、`skill_entitlements` | 钱包扣款 → entitlement → acquire |
| ZIP 下载 | `/api/skills/[id]/download` | 流式返回 `createZipStore`（store-method） |
| SKILL.md 包 | `/api/skills/[id]/package` | SkillHub 标准包（含 YAML frontmatter） |
| Store MCP | `/api/mcp/store` + `src/lib/agent-install/store-mcp/` | `search_assets` / `get_asset` / `install_asset` |
| UI 组件 | `SkillPurchase`、`SkillInstallPanel` | 获取授权 + 安装指引 |

---

### 9.2 不一致 / 缺失（⚠️）

| 项 | 现状 | 问题 | 目标（v2.0） |
|----|------|------|-------------|
| **匿名 package 下载** | 免费 Skill `/package` 可匿名 | 与 `/download` 强制登录不一致；无法追踪用户 | **P0**：`/package` 强制登录（session / Bearer / OAuth） |
| **Store MCP 匿名安装** | 免费 Skill `install_asset` 可匿名 | 无法记录 `skill_downloads`，统计不准 | **P0**：`install_asset` 强制认证（OAuth / Bearer） |
| **OAuth 认证** | 无 | Agent 必须手动粘贴 API Key | **P0**：Device Code Flow；**P2**：Authorization Code Flow |
| **下载列表** | 无专门页面 | 用户不知道自己获取了哪些 Skill | **P0**：`/dashboard/skills/downloads` 页面 + `skill_downloads` 表扩展 |
| **安装列表** | 无 | 用户不知道哪些 Skill 已部署到本地 | **P1**：`/dashboard/skills/installs` 页面 + `skill_installs` 表（新增） |
| **Skill 包回链** | SKILL.md 无 `openmcp` 元数据块 | 用户不知道 Skill 来源，无法回溯市场 | **P0**：`buildSkillPackage` 插入 `openmcp` 字段（skillUrl, slug, installDocUrl 等） |
| **安装回调** | 无 | 平台不知道用户真实安装情况 | **P1**：`POST /api/skills/[id]/install-callback` + `skill_installs` 表 |
| **GitHub 源最小包** | GitHub 类型 Skill 只返回 URL | Agent 无法解析元数据 | **P1**：GitHub 类型生成最小 SKILL.md 包（仅含 `openmcp` 元数据） |
| **securityGrade UI** | 详情页有 Alert，列表页无徽标 | 信任信号不前置 | **P0**：列表页卡片显示 safe/caution Badge |

---

### 9.3 新增功能清单

| 功能 | 优先级 | 说明 |
|------|--------|------|
| `/package` 端点强制登录 | **P0** | 修改路由中间件，校验 session / Bearer / OAuth |
| Store MCP OAuth 认证 | **P0** | Device Code Flow 端点（`/oauth/device`, `/oauth/token`） + Agent 侧轮询逻辑 |
| `skill_downloads` 表扩展 | **P0** | 新增字段：`status`, `skill_version`, `skill_title`, `skill_slug` |
| `skill_installs` 表新增 | **P1** | 完整表结构（user+skill+runtime unique） |
| `/dashboard/skills/downloads` 页面 | **P0** | 列表展示 + 操作按钮（再次下载、查看详情、安装） |
| `/dashboard/skills/installs` 页面 | **P1** | 列表展示 + 操作按钮（卸载、重新安装、查看详情） |
| `POST /api/skills/[id]/install-callback` | **P1** | 接收 Agent 安装成功回调，写入 `skill_installs` |
| `buildSkillPackage` 插入 `openmcp` 元数据 | **P0** | YAML frontmatter 新增 `openmcp` 字段块（skillUrl, slug 等） |
| `securityGrade` 徽标前置 | **P0** | 列表页卡片显示 safe/caution Badge |
| GitHub 类型最小包生成 | **P1** | 返回仅含元数据的 SKILL.md（`.openmcp-meta.md`） |
| Authorization Code Flow（Browser Redirect） | **P2** | 需 Cursor / Claude Desktop 协议注册支持 |

---

## 10. 版本管理系统设计（已实现）

### 10.1 数据模型

完整的 `skill_versions` 表结构：

```sql
CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version VARCHAR(20) NOT NULL,           -- 语义化版本号（如 1.0.0）
  content JSONB NOT NULL,                 -- 旧格式兼容字段
  source_files JSONB,                     -- 源文件快照（新格式）
  package_metadata JSONB,                 -- 包元数据（title、platforms 等）
  changelog TEXT,                         -- 更新日志
  status VARCHAR(20) DEFAULT 'draft',     -- draft/published/yanked/archived
  published_at TIMESTAMP,                 -- 发布时间
  created_by TEXT REFERENCES user(id),    -- 创建者
  security_grade VARCHAR(20),             -- 安全评级快照
  security_scanned_at TIMESTAMP,          -- 扫描时间
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(skill_id, version)
);
```

**当前版本指针**：`skills.version` 字段指向市场默认版本（用户未指定版本时获取此版本）。

### 10.2 Provider 工作流

#### 发布新版本

1. **创建新版本**：
   ```typescript
   await skills.createVersion({
     skillId: 'skill_xxx',
     version: '1.1.0',
     changelog: '新增功能 X，修复 bug Y',
     autoPublish: true  // 可选：直接发布并设为当前版本
   })
   ```

2. **发布草稿版本**：
   ```typescript
   await skills.publishVersion({
     skillId: 'skill_xxx',
     version: '1.1.0'
   })
   ```

3. **设置为当前版本**（发布后自动设置，或手动回滚）：
   ```typescript
   await skills.setCurrentVersion({
     skillId: 'skill_xxx',
     version: '1.0.0'  // 回滚到旧版本
   })
   ```

#### 版本状态流转

```
draft ──publish──> published ──yank──> yanked
  │                    │
  └─────────────────────┴──────────────> archived
```

- **draft**：草稿，仅 Provider 可见
- **published**：已发布，用户可下载
- **yanked**：已撤回，用户无法下载（但已下载的不受影响）
- **archived**：归档，不再显示

#### 撤回版本（Yank）

```typescript
await skills.yankVersion({
  skillId: 'skill_xxx',
  version: '1.0.1'  // 不能撤回当前版本
})
```

**限制**：当前正在使用的版本不能被撤回，需先设置其他版本为当前版本。

### 10.3 用户/Agent 工作流

#### 下载特定版本

**Web UI**：
- 详情页显示版本选择器，列出所有已发布版本
- 用户选择版本后点击「下载」，获取该版本的 ZIP 包

**API 调用**：
```bash
# 下载当前版本（默认）
GET /api/skills/{id}/download

# 下载特定版本
GET /api/skills/{id}/download?version=1.0.0

# tRPC acquire
skills.acquire({ id: 'skill_xxx', version: '1.0.0' })
```

**Store MCP**：
```json
{
  "method": "install_asset",
  "params": {
    "kind": "skill",
    "id": "dev-expert",
    "version": "1.0.0"
  }
}
```

#### 版本历史查看

```typescript
// 列出所有已发布版本（普通用户）
const versions = await skills.listVersions({
  skillId: 'skill_xxx',
  isProvider: false  // 仅显示 published
})

// 列出所有版本（Provider）
const allVersions = await skills.listVersions({
  skillId: 'skill_xxx',
  isProvider: true  // 显示所有状态
})
```

返回示例：
```json
[
  {
    "id": "sv_xxx",
    "skillId": "skill_xxx",
    "version": "1.1.0",
    "status": "published",
    "publishedAt": "2026-09-22T10:00:00Z",
    "changelog": "新增功能 X",
    "isCurrent": true
  },
  {
    "id": "sv_yyy",
    "version": "1.0.0",
    "status": "published",
    "publishedAt": "2026-09-01T10:00:00Z",
    "changelog": "初始版本",
    "isCurrent": false
  }
]
```

### 10.4 下载/安装记录

**`skill_downloads`** 和 **`skill_installs`** 表的 `skillVersion` 字段记录实际获取的版本：

```sql
-- 用户下载记录
SELECT 
  skill_title,
  skill_version,  -- 实际下载的版本（可能不是当前版本）
  downloaded_at
FROM skill_downloads
WHERE user_id = 'user_xxx'

-- 用户安装记录
SELECT
  skill_title,
  skill_version,  -- 实际安装的版本
  runtime,
  status
FROM skill_installs
WHERE user_id = 'user_xxx'
```

### 10.5 安全与回滚策略

1. **版本独立扫描**：每个版本有独立的 `security_grade` 快照，新版本发布前需重新扫描
2. **回滚安全**：回滚到旧版本不会绕过安全审核（旧版本已有扫描结果）
3. **Yank 机制**：发现安全问题时，Provider 可立即撤回问题版本，阻止新下载
4. **已安装不受影响**：Yank 不会影响已下载/安装的用户（由用户决定是否升级）

### 10.6 语义化版本约束

- **版本号格式**：必须符合 [Semantic Versioning](https://semver.org/)（如 `1.0.0`、`2.1.3-beta`）
- **版本唯一性**：同一 Skill 不能有重复版本号
- **版本排序**：按 semver 规则排序（`1.0.0` < `1.0.1` < `1.1.0` < `2.0.0`）

---

## 11. UX 线框图

### 10.1 我的下载页面（`/dashboard/skills/downloads`）

```
┌────────────────────────────────────────────────────────────┐
│  Dashboard · 我的下载                                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  筛选：[全部] [免费] [付费] [最近 30 天]                   │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Dev Expert v1.0.0              🟢 safe              ││
│  │ 下载时间：2026-09-21 14:30                          ││
│  │ [查看详情] [再次下载] [安装]                        ││
│  └──────────────────────────────────────────────────────┘│
│                                                            │
│  ┌──────────────────────────────────────────────────────┐│
│  │ GitHub Copilot MCP v2.1.0      🟡 caution           ││
│  │ 下载时间：2026-09-20 09:15                          ││
│  │ [查看详情] [再次下载] [安装]                        ││
│  └──────────────────────────────────────────────────────┘│
│                                                            │
│  显示 1-10 / 共 23 条                                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

### 10.2 我的安装页面（`/dashboard/skills/installs`）

```
┌────────────────────────────────────────────────────────────┐
│  Dashboard · 我的安装                                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  筛选：[全部] [Cursor] [Claude Code] [Codex] [已激活]     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Dev Expert v1.0.0              Runtime: Cursor      ││
│  │ 安装路径：~/.cursor/skills/dev-expert/              ││
│  │ 安装时间：2026-09-21 14:35     最后使用：今天        ││
│  │ 状态：✅ 已激活                                     ││
│  │ [查看详情] [卸载] [重新安装]                        ││
│  └──────────────────────────────────────────────────────┘│
│                                                            │
│  ┌──────────────────────────────────────────────────────┐│
│  │ GitHub Copilot MCP v2.1.0      Runtime: Claude Code││
│  │ 安装路径：~/.claude/mcps/github-copilot/            ││
│  │ 安装时间：2026-09-20 09:20     最后使用：昨天        ││
│  │ 状态：✅ 已激活                                     ││
│  │ [查看详情] [卸载] [重新安装]                        ││
│  └──────────────────────────────────────────────────────┘│
│                                                            │
│  显示 1-5 / 共 5 条                                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

### 10.3 详情页安装按钮（更新后）

```
┌──────────────────────────────────────────────┐
│  📦 免费使用 · ¥0                            │
│  ⚠️ 风险提示：该技能安全评级为 caution      │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │  [免费获取] ← 需登录                  │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  继续即表示您同意买家服务条款                │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  🚀 安装到你的 AI Agent                      │
│                                              │
│  请将以下提示词发送给你的 AI：               │
│  ┌──────────────────────────────────────┐  │
│  │ 请根据 openmcp.cn/install/openmcp.md│  │
│  │ 安装 dev-expert。                    │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  [📋 复制 prompt] ← 主 CTA（大按钮）        │
│                                              │
│  [📥 下载 Zip 包安装] ← 需登录              │
│                                              │
│  [📂 安装到本地 Agent ▼] ← 折叠面板         │
│    │                                         │
│    ├─ Runtime: [Cursor] [Claude] [Codex]   │
│    ├─ 目标目录：~/.cursor/skills/dev-expert/│
│    └─ 步骤：                                 │
│       1. 下载 ZIP（需登录）                  │
│       2. 解压到目标目录                      │
│       3. （可选）标记已安装（自动回调）       │
│       4. 重载 Agent 会话                    │
│                                              │
│  [📄 复制给 Agent 的说明（备用）▼]         │
│    └─ （折叠，显示长提示词）                │
└──────────────────────────────────────────────┘
```

---

## 12. 实现批次

### 批次 P0：登录必需 + OAuth + 下载列表 + 元数据回链（**需确认后再编码**）

| 任务 | 范围 | 预期产出 |
|------|------|---------|
| **1. `/package` 端点强制登录** | 修改 `src/app/api/skills/[id]/package/route.ts` | 免费/付费 Skill 的 `/package` 均需登录（session / Bearer / OAuth） |
| **2. Store MCP OAuth Device Code Flow** | 新增端点：`/api/mcp/store/oauth/device`、`/api/mcp/store/oauth/token`、`/device` 页面 | Agent 可通过 Device Code Flow 获取 access_token，无需手动粘贴 API Key |
| **3. `oauth_device_codes` + `oauth_tokens` 表** | 新增数据库表 | 存储 device_code、user_code、access_token 哈希 |
| **4. `skill_downloads` 表扩展** | 新增字段：`status`, `skill_version`, `skill_title`, `skill_slug` | 冗余存储 skill 元数据，防止 skill 删除后无法显示 |
| **5. `/dashboard/skills/downloads` 页面** | 新增页面 + 组件 | 列表展示已下载 Skill，支持筛选、再次下载、查看详情 |
| **6. `buildSkillPackage` 插入 `openmcp` 元数据** | 修改 `src/lib/agent-install/skill-package.ts` | SKILL.md frontmatter 新增 `openmcp` 字段块（skillUrl, slug, installDocUrl 等） |
| **7. `securityGrade` 徽标前置** | 修改列表页卡片组件 + 详情页 hero | 列表页显示 safe/caution Badge，详情页 hero 区显示风险 Alert |
| **8. Store MCP `install_asset` 强制认证** | 修改 `src/lib/agent-install/store-mcp/tools.ts` | 免费 Skill 也需 Bearer / OAuth，写入 `skill_downloads` |
| **9. 文档更新** | 更新 `USER_MARKETPLACE.md`、`AGENT_INSTALL.md`、`/install/openmcp.md` | 同步最新登录要求 + OAuth 流程 |

---

### 批次 P1：安装列表 + 回调 API + GitHub 最小包（后续迭代）

| 任务 | 范围 | 预期产出 |
|------|------|---------|
| **10. `skill_installs` 表新增** | 新增数据库表（user+skill+runtime unique） | 存储用户真实安装记录 |
| **11. `POST /api/skills/[id]/install-callback`** | 新增端点 | 接收 Agent 回调，写入 `skill_installs` |
| **12. `/dashboard/skills/installs` 页面** | 新增页面 + 组件 | 列表展示已安装 Skill，支持筛选、卸载、重新安装 |
| **13. Store MCP 自动回调** | 修改 `install_asset` 工具 | Agent 安装成功后自动调用 `install-callback` |
| **14. GitHub 类型最小包** | 修改 `buildSkillPackage` | GitHub Skill 生成仅含 `openmcp` 元数据的 `.openmcp-meta.md` |
| **15. UI 组件职责明确** | 重构 `SkillPurchase` vs `SkillInstallPanel` | 减少维护成本 |
| **16. 下载进度 toast** | 前端优化 | `/download` 调用时显示「下载中…」toast |

---

### 批次 P2：未来功能（标记，不本轮实现）

| 任务 | 范围 | 预期产出 |
|------|------|---------|
| **17. Authorization Code Flow（Browser Redirect）** | 新增端点：`/oauth/authorize`、协议注册 `cursor://oauth-callback` | Agent 无需轮询，授权后立即回调 |
| **18. 深度链接一键安装** | 协议注册 `cursor://install-skill?url=...` | 一键唤起 Cursor 安装 |
| **19. 版本管理** | `skill_versions` 表 + 多版本 UI | 支持回滚与并存 |
| **20. Refresh Token** | OAuth 刷新令牌机制 | access_token 过期后自动刷新 |

---

## 13. 验收标准

### 12.1 功能验收（P0）

- [ ] **免费 Skill `/package` 需登录**：未登录用户访问 `/api/skills/<free-skill-id>/package` 返回 401；登录后返回 200 + ZIP。
- [ ] **付费 Skill `/package` 需 entitlement**：未购买用户返回 403；已购返回 200 + ZIP。
- [ ] **Store MCP `install_asset` 需认证**：无 Bearer / OAuth 调用免费 Skill 的 `install_asset` 返回 401；认证后返回 200 + 包内容。
- [ ] **Device Code Flow**：Agent 调用 `/oauth/device` 获取 `user_code`，用户在浏览器输入后授权成功，Agent 轮询 `/oauth/token` 获得 `access_token`。
- [ ] **下载列表**：用户访问 `/dashboard/skills/downloads` 可看到已调用 `acquire` 的所有 Skill，支持再次下载、查看详情。
- [ ] **Skill 包回链**：下载的 SKILL.md ZIP 解压后，YAML frontmatter 包含 `openmcp.skillUrl`、`openmcp.slug`、`openmcp.installDocUrl` 等字段。
- [ ] **安全徽标**：列表页卡片显示 `securityGrade` Badge（safe 绿 / caution 黄）；详情页 caution 显示风险 Alert。
- [ ] **计数准确**：首次 `acquire` 写入 `skill_downloads` + `downloads++`；后续「下载 ZIP」不重复计数。

---

### 12.2 功能验收（P1）

- [ ] **安装列表**：用户访问 `/dashboard/skills/installs` 可看到已回调 `install-callback` 的所有 Skill，显示 Runtime、安装路径、状态。
- [ ] **安装回调**：Agent（或用户）调用 `POST /api/skills/[id]/install-callback` 成功写入 `skill_installs`，状态为 `active`。
- [ ] **Store MCP 自动回调**：`install_asset` 工具安装成功后自动调用 `install-callback`，无需用户手动标记。
- [ ] **GitHub 最小包**：GitHub 类型 Skill 的 `acquire` 返回最小 SKILL.md 包（`.openmcp-meta.md`），含 `openmcp` 元数据块。

---

### 12.3 安全验收

- [ ] 付费 Skill 未购买时，所有下载端点（`/download`、`/package`、`install_asset`）均返回 403。
- [ ] caution 等级 Skill 可正常下载，但详情页 + 获取对话框显示风险提示。
- [ ] MCP / A2A 安装配置中**仅包含**平台网关 URL，无 Provider 私有端点。
- [ ] OAuth `device_code` 和 `access_token` 均以 SHA-256 哈希存储，明文不入库。
- [ ] Device Code Flow 轮询频率限制：同一 `device_code` 每 5s 最多查询一次。

---

### 12.4 UI 验收

- [ ] `SkillPurchase` 组件：
  - 免费 / 付费按钮文案正确（「免费获取」「立即购买」「立即获取」）
  - 未登录点击按钮弹出登录框
  - caution Alert 显示风险摘要
  - 获取成功 Dialog 显示文件列表 + 下载 ZIP 按钮
- [ ] `SkillInstallPanel` 组件：
  - 主 CTA「复制 prompt」按钮醒目（大尺寸、前景色背景）
  - 「下载 Zip 包安装」按钮 secondary 样式，点击需登录
  - 折叠面板：Runtime tabs、目标目录、步骤指引（含「标记已安装」提示）
- [ ] 列表页卡片：
  - 显示 `securityGrade` Badge（safe 绿 / caution 黄）
  - 显示 `downloads` 计数
  - 免费 / 付费标签清晰
- [ ] `/device` 页面：
  - 用户输入 `user_code` 后显示授权确认页
  - 授权成功后显示「可关闭此页」提示

---

### 12.5 文档验收

- [x] `USER_MARKETPLACE.md` 更新登录边界说明（所有 `/package` 和 `install_asset` 均需登录）。
- [x] `AGENT_INSTALL.md` 更新 OAuth Device Code Flow 说明（含 `mcp.json` 配置示例）。
- [x] `/install/openmcp.md` 同步最新的 `/package` 端点用法（需登录提示）。
- [x] 本设计文档在 `USER_MARKETPLACE.md` / `AGENT_INSTALL.md` 中添加交叉链接。

> 2026-09-27 补齐：`public/install/openmcp.md` §2/§3 已改为「所有 Skill 包下载需登录或带 API Key」，并移除「免费可匿名」说法；`AGENT_INSTALL.md` §8 同步修正。

---

## 14. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| **用户市场** | [USER_MARKETPLACE.md](./USER_MARKETPLACE.md) | 免费 / 付费获取流程 |
| **Agent 安装** | [AGENT_INSTALL.md](./AGENT_INSTALL.md) | P0 提示词 + P1 Store MCP |
| **发布政策** | [SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md) | Provider 上架规则、安全扫描 |
| **Provider OAuth Mode①** | [PROVIDER_OAUTH_MODE1.md](./PROVIDER_OAUTH_MODE1.md) | Provider 授权上游 MCP 工具（与本设计的 Platform Login OAuth 独立） |
| **安装文档（Agent 可读）** | [/install/openmcp.md](/install/openmcp.md) | 公开文档，按 slug 下载 Skill 包 |
| **API 实现** | `src/web/skills/acquire.ts`<br>`src/app/api/skills/[id]/download/route.ts`<br>`src/app/api/skills/[id]/package/route.ts` | tRPC 与 Next.js API Routes |
| **UI 组件** | `src/components/skills/skill-purchase.tsx`<br>`src/components/agent-install/skill-install-panel.tsx` | React 客户端组件 |
| **Store MCP** | `src/lib/agent-install/store-mcp/tools.ts`<br>`src/app/api/mcp/store/route.ts` | MCP JSON-RPC 端点 |
| **OAuth 实现** | `src/lib/agent-install/store-mcp/oauth.ts`（**新增**）<br>`src/app/api/mcp/store/oauth/device/route.ts`（**新增**）<br>`src/app/api/mcp/store/oauth/token/route.ts`（**新增**）<br>`src/app/[locale]/(marketing)/(pages)/device/page.tsx`（**新增**） | OAuth Device Code Flow |

---

## 附录：关键代码锚点

### A.1 数据模型（扩展/新增）

```typescript
// src/db/schema (伪代码)

// ===== 扩展现有表 =====
skill_downloads {
  id, skillId, userId, ipAddress, userAgent, createdAt,
  // 新增字段
  status: 'downloaded' | 'failed',  // 固定 'downloaded'
  skill_version: string | null,
  skill_title: string,
  skill_slug: string,
  UNIQUE(userId, skillId)
}

// ===== 新增表 =====
skill_installs {
  id, skillId, userId, runtime, install_path, status, installed_at, last_used_at,
  skill_version, skill_title, skill_slug,
  UNIQUE(userId, skillId, runtime)
}

oauth_device_codes {
  id, device_code, user_code, client_id, scope, status, user_id, expires_at, created_at
}

oauth_tokens {
  id, token_hash, user_id, client_id, scope, expires_at, created_at
}
```

---

### A.2 新增 API 端点

| 路径 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/api/mcp/store/oauth/device` | POST | 无 | 生成 `device_code` + `user_code` |
| `/api/mcp/store/oauth/token` | POST | 无 | 轮询换取 `access_token` |
| `/device` | GET | session（登录后） | 用户输入 `user_code` 授权页 |
| `/api/mcp/store/oauth/authorize` | POST | session | 用户点击「授权」，标记 `device_code` 为 authorized |
| `/api/skills/[id]/install-callback` | POST | session / Bearer / OAuth | Agent 回调记录安装 |

---

### A.3 修改现有端点

| 路径 | 原鉴权 | 新鉴权 | 说明 |
|------|--------|--------|------|
| `/api/skills/[id]/package` | 免费可匿名 | **强制登录**（session / Bearer / OAuth） | 统一授权流程 |
| `install_asset`（Store MCP） | 免费可匿名 | **强制认证**（Bearer / OAuth） | 记录 `skill_downloads` |

---

### A.4 UI 组件修改

```tsx
// src/components/skills/skill-purchase.tsx
export function SkillPurchase({ skillId, priceType, securityGrade, ... }) {
  // 点击「免费获取」「立即购买」「立即获取」
  // 未登录 → 弹出登录框（better-auth）
  // 登录后调用 skills.acquire
  // 成功后 Dialog 显示文件列表 + 下载 ZIP 按钮
}

// src/components/agent-install/skill-install-panel.tsx
export function SkillInstallPanel({ asset, locale, packageUrl }) {
  // 主 CTA：「复制 prompt」
  // Secondary：「下载 Zip 包安装」（需登录）
  // 折叠：Runtime tabs + 目标目录 + 步骤（含「标记已安装」提示）
}
```

---

### A.5 新增页面

| 路径 | 组件 | 说明 |
|------|------|------|
| `/dashboard/skills/downloads` | `SkillDownloadsList` | 展示 `skill_downloads` 表，支持再次下载、查看详情 |
| `/dashboard/skills/installs` | `SkillInstallsList` | 展示 `skill_installs` 表，支持卸载、重新安装 |
| `/device` | `DeviceAuthPage` | OAuth Device Code Flow 授权页，用户输入 `user_code` |

---

## 版本历史

- **v2.1（2026-09-27）**：文档验收（§12.5）补齐；Bearer Key 明确为 Dashboard 代理 LiteLLM 签发的 Virtual Key（见 [API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)）
- **v2.0（2026-09-22）**：完全重写，新增登录必需 + Agent OAuth + 下载/安装列表 + Skill 包回链元数据
- **v1.0（2026-09-22）**：原有设计（匿名 `/package` + 仅 Bearer 认证）

---

## 下一步

**🚧 本设计稿需用户确认后再编码 🚧**

请审阅以下关键决策点：

1. **登录必需（Login-Required Everywhere）**：所有 Skill 下载/安装路径均需登录，取消匿名访问 → ✅ 同意 / ❌ 需调整
2. **Agent OAuth（Device Code Flow P0）**：优先实现 Device Code Flow，Authorization Code Flow 标记 P2 → ✅ 同意 / ❌ 需调整
3. **下载列表 vs 安装列表**：`skill_downloads`（用户获取记录）vs `skill_installs`（真实部署记录） → ✅ 同意 / ❌ 需调整
4. **Skill 包回链元数据**：SKILL.md frontmatter 新增 `openmcp` 字段块（skillUrl, slug, installDocUrl 等） → ✅ 同意 / ❌ 需调整
5. **实现批次**：P0（登录+OAuth+下载列表+元数据）→ P1（安装列表+回调）→ P2（Browser Redirect OAuth+深度链接+版本管理） → ✅ 同意 / ❌ 需调整

确认后，开始 P0 编码工作。
