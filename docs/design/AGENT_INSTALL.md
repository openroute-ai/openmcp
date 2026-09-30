# Agent 自动安装（Install into Agent）

> 版本：v1.3（2026-09-30）· Catalog search + recommend  
> 范围：`apps/openmcp` · 市场资产装进 Cursor / Claude Code / Codex / 通用 Agent  
> 决策：仅平台网关 URL；**不**支持 Provider 直连端点安装；**支持 OAuth 认证**  
> API Key 架构：Dashboard 代理签发 LiteLLM Virtual Key，见 [API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)  
> 用户下载安装完整设计：[SKILL_USER_DOWNLOAD_INSTALL.md](./SKILL_USER_DOWNLOAD_INSTALL.md) ⬅️ **v2.0：登录必需 + Agent OAuth（Device Code Flow）**

---

## 1. 产品决策（已确认）

| # | 决策 |
|---|------|
| 1 | 先落地 **P0**（提示词生成 + UI），再 **P1**（OpenMCP Store MCP） |
| 2 | Runtime：`cursor` \| `claude-code` \| `codex` \| `generic-prompt` |
| 3 | MCP / A2A 安装只给 **平台网关 URL** + 用户 API Key（Dashboard → API Keys） |
| 4 | 安装 UX **禁止** Provider 直连 endpoint |

---

## 2. P0 — Install prompt generator + UI

### 2.1 目标

用户在 Skill / MCP / A2A 详情页选择 Runtime，一键复制「装进 Agent」提示词（中文为主，英文可选），粘贴到本地 Agent 后按步骤完成安装。

### 2.2 代码锚点

| 模块 | 路径 |
|------|------|
| 类型 | `src/lib/agent-install/types.ts` |
| 提示词 | `src/lib/agent-install/prompts.ts` |
| 网关 URL | `src/lib/agent-install/urls.ts` |
| UI | `src/components/agent-install/install-into-agent.tsx` |
| 起步页 | `src/app/[locale]/(marketing)/(pages)/start/page.tsx` |
| 复用复制 | `src/components/copy-prompt.tsx` |

### 2.3 AssetKind × Runtime 行为

| kind | 提示词内容 |
|------|------------|
| **skill** | 从 openmcp 详情 URL 获取；按 Runtime 放入对应 skills 目录；校验步骤；付费需先登录获取 |
| **mcp** | 平台网关 `{GATEWAY}/{serverName}/mcp` + API Key 占位；Cursor/Claude/Codex 的 `mcp.json` / CLI 片段；**仅网关** |
| **a2a** | 平台网关 Agent Card / invoke 路径 + `Authorization: Bearer <API_KEY>` 模板；**仅网关** |

`generic-prompt`：不绑定具体 IDE，给出可复制的通用步骤。

### 2.4 UI：`InstallIntoAgent`

- Runtime tabs / select + Copy（`CopyPrompt`）
- MCP 可选展示 JSON snippet 预览
- 链到 `/start`
- 挂载：Skill 详情侧栏、MCP / A2A 详情 rail（或 hero 旁）

### 2.5 `/start` 增强（在既有落地页上增强，不重复造页）

步骤改为：

1. 选择 Runtime  
2. 复制「先装商店」bootstrap 提示词（含后续 P1 的 Store MCP 片段）  
3. 浏览 / 安装第一个免费 Skill  

嵌入 `InstallIntoAgent` demo（bootstrap 模式）。

### 2.6 验收（P0）

1. 三详情页均可按 Runtime 复制安装提示词。  
2. MCP / A2A 文案与 snippet **不含** Provider `endpoint`。  
3. `/start` 含 Runtime 选择与 bootstrap 复制。  
4. 无密钥明文入库；占位符指向 Dashboard API Keys。

---

## 3. P1 — OpenMCP Store MCP（最小）

### 3.1 目标

平台托管一个 MCP 兼容 HTTP API，Agent 注册后可：`search_assets` → `get_asset` → `install_asset`。

### 3.2 端点

- **URL**：`{BASE_URL}/api/mcp/store`（Streamable HTTP / JSON-RPC）  
- **鉴权（v2.0 OAuth 支持）**：
  - **Bearer Token（API Key）**：`Authorization: Bearer sk-...`（Dashboard 签发的网关 Key，虚拟 Key 见 [API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)）
  - **OAuth Device Code Flow（P0）**：无需手动粘贴 Key，Agent 显示 6 位码，用户在浏览器授权，详见 [SKILL_USER_DOWNLOAD_INSTALL.md §7](./SKILL_USER_DOWNLOAD_INSTALL.md#7-agent-oauth-流程设计)
  - **OAuth Authorization Code Flow（P2）**：浏览器重定向 OAuth，适用于支持协议注册的 IDE（如 `cursor://oauth-callback`），详见下文 §3.6
  - ⚠️ **搜索/查看可匿名**，但 **`install_asset` 必须登录**（v2.0 变更）
- **禁止**：Direct Provider endpoint 模式

### 3.3 Tools（最小集）

| Tool | 作用 |
|------|------|
| `search_assets` | 结构化搜索 skill / mcp / a2a / app（`q?`, `kind?`, `tags?`, `categorySlug?`, `priceType?`, `securityGrade?`, `sort?`, `limit?`）；默认热度排序 |
| `recommend_assets` | Chat/AI 选型：`useCase` → 推荐列表 + `reason`（复用 catalog search） |
| `get_asset` | 详情 + 安装元数据（id / slug / kind） |
| `install_asset` | 按 `runtime` 返回安装 payload（files 列表 / mcp 配置 snippet / a2a card URL）。付费 Skill 校验 entitlement（对齐 `skills.acquire`）；免费放行 |

### 3.4 实现取向

优先 Next.js Route：`src/app/api/mcp/store/route.ts`，复用 `skills` / `mcpServers` / `a2aAgents` 数据访问与 `acquireSkill` entitlement。不新增 Provider 直连配置。

客户端注册示例（Cursor `mcp.json`）：

```json
{
  "mcpServers": {
    "openmcp-store": {
      "url": "https://www.openmcp.cn/api/mcp/store",
      "headers": {
        "Authorization": "Bearer YOUR_OPENMCP_API_KEY"
      }
    }
  }
}
```

**推荐配置（v2.0 OAuth）**：

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

Agent 首次调用 `install_asset` 时自动触发 OAuth 授权流程（Device Code Flow），用户在浏览器完成授权后 Agent 获取 `access_token`。详细流程见 [SKILL_USER_DOWNLOAD_INSTALL.md §7](./SKILL_USER_DOWNLOAD_INSTALL.md#7-agent-oauth-流程设计)。

> ⚠️ 上面的 `authMode` / `deviceCodeUrl` / `tokenUrl` 是**给 Agent 读的提示字段**，不是 Cursor / Claude Code / Codex 会解析的配置键。真实客户端不会据此自动发起 OAuth：轮询逻辑需由 Agent 侧实现（见 [SKILL_USER_DOWNLOAD_INSTALL.md §7.5](./SKILL_USER_DOWNLOAD_INSTALL.md#75-agent-侧实现store-mcp)，当前未实现），或直接使用 API Key。`/api/mcp/store` 也尚未提供 `/.well-known/oauth-protected-resource` 发现文档。

`/start` 与 `InstallIntoAgent` 的「添加 OpenMCP Store MCP」snippet 按 Runtime 生成。

### 3.6 Authorization Code Flow（P2）

**适用场景**：IDE 支持协议注册（如 Cursor `cursor://oauth-callback`），可接收浏览器回调。

**端点**：

1. **Authorize**：`GET /api/mcp/store/oauth/authorize`
   - Query params:
     - `response_type=code`（必需）
     - `client_id`（如 `openmcp-store`）
     - `redirect_uri`（如 `cursor://oauth-callback`）
     - `scope`（可选，默认 `skills:read skills:install`）
     - `state`（可选，CSRF 保护）
     - `code_challenge` + `code_challenge_method`（可选，PKCE 支持）
   - 流程：
     1. 未登录 → 重定向到 `/auth/login`
     2. 已登录 → 显示授权确认页 `/oauth/authorize`
     3. 用户确认 → 生成 `authorization_code`，重定向回 `redirect_uri?code=xxx&state=xxx`

2. **Token Exchange**：`POST /api/mcp/store/oauth/token`
   - Body:
     ```json
     {
       "grant_type": "authorization_code",
       "code": "xxx",
       "redirect_uri": "cursor://oauth-callback",
       "client_id": "openmcp-store",
       "code_verifier": "xxx" // PKCE
     }
     ```
   - Response:
     ```json
     {
       "access_token": "eyJhbG...",
       "token_type": "Bearer",
       "expires_in": 2592000,
       "scope": "skills:read skills:install"
     }
     ```

**Client 注册**：

默认 public client `openmcp-store` 已注册，支持：
- `redirect_uris`: `['cursor://oauth-callback', 'claude://oauth-callback', 'http://localhost:3000/oauth/callback']`
- `grant_types`: `['authorization_code', 'device_code']`

**PKCE 支持**：

推荐 public client 使用 PKCE (RFC 7636) 提升安全性：
1. Agent 生成 `code_verifier`（随机字符串）
2. 计算 `code_challenge = BASE64URL(SHA256(code_verifier))`
3. Authorize 请求带 `code_challenge` + `code_challenge_method=S256`
4. Token 请求带 `code_verifier`，平台校验一致性

### 3.7 验收（P1）

1. `initialize` / `tools/list` / `tools/call` 可用。  
2. `search_assets` 仅返回 `published`。  
3. 付费 Skill 无 entitlement 时 `install_asset` 失败并提示购买。  
4. 安装 payload **仅**平台网关标识，无 Provider endpoint。  
5. 文档与 UI snippet 一致。

---

## 4. 网关 URL 约定

| 资源 | 客户端使用的 URL |
|------|------------------|
| 市场 MCP | `{GATEWAY_BASE}/{serverName}/mcp` |
| 市场 A2A | `{GATEWAY_BASE}/a2a/{agentName}`（Agent Card：`…/.well-known/agent-card.json`） |
| Store MCP | `{APP_BASE}/api/mcp/store` |

`GATEWAY_BASE`：`NEXT_PUBLIC_GATEWAY_BASE_URL`（默认 `https://api.openmcp.cn`）。  
`{serverName}` / `{agentName}` 即 LiteLLM 侧的 server name / agent name（`{providerSlug}__{assetName}`），路径形状与 LiteLLM 网关一致。  
用户密钥：Dashboard → `/dashboard/apikeys`，签发的是 **LiteLLM Virtual Key**（`sk-…`），同一把 Key 同时用于网关与 Skill 包下载，详见 [API_KEY_LITELLM_PROXY.md](./API_KEY_LITELLM_PROXY.md)。

网关鉴权头（两者均可，`x-litellm-api-key` 为 LiteLLM 首选）：

```
x-litellm-api-key: sk-...
# 或
Authorization: Bearer sk-...
```

Store MCP / Skill 包（`{APP_BASE}` 侧）接受同一把 Key：

```
Authorization: Bearer sk-...
# 或
x-litellm-api-key: sk-...
```

---

## 5. 非目标

- Provider 直连安装  
- Stdio MCP 自动安装  
- 完整 OAuth 到 Agent IDE  
- 安装状态回写 / 结算（后续）

---

## 6. 提交节奏

1. `feat(openmcp): P0 agent install prompts and detail CTAs`  
2. `feat(openmcp): P1 OpenMCP Store MCP search get install`  

---

## 7. 实现状态

| 阶段 | 状态 | Commit message |
|------|------|----------------|
| P0 | ✅ | `feat(openmcp): P0 agent install prompts and detail CTAs` |
| P1 | ✅（本仓 `apps/web`） | `feat(web): Store MCP search/get/install + Device Code OAuth` |

### P1 代码锚点（monorepo）

| 模块 | 路径 |
|------|------|
| HTTP MCP | `apps/web/src/app/api/mcp/store/route.ts` |
| Handler | `apps/web/src/lib/agent-install/store-mcp/handler.ts` |
| Tools | `apps/web/src/lib/agent-install/store-mcp/tools.ts` |
| API Key / OAuth 鉴权 | `apps/web/src/lib/agent-install/store-mcp/auth.ts`（SHA-256 ↔ `api_keys.key` / `oauth_tokens.token_hash`） |
| Device Code | `apps/web/src/app/api/mcp/store/oauth/{device,token,authorize}/route.ts` + `/device` UI |
| apps/api 薄代理 | `apps/api/src/routes/mcp/store.ts` → 需 `OPENMCP_WEB_BASE_URL` |

### 已知缺口（诚实记录）

- Cursor / Claude Code **不会**自动解析 `authMode` / `deviceCodeUrl`；Device Code 轮询需 Agent 侧实现，或直接用 API Key。
- 尚无 `/.well-known/oauth-protected-resource` 发现文档。
- Authorization Code Flow UI 已有；深度链接 IDE 回调为后续。
- `install-callback` 登记安装列表未在本批强制接通（表已存在）。

### 手动验证（P1）

```bash
# 发现
curl -sS "$BASE/api/mcp/store" | jq .

# initialize
curl -sS -X POST "$BASE/api/mcp/store" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list
curl -sS -X POST "$BASE/api/mcp/store" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# search_assets
curl -sS -X POST "$BASE/api/mcp/store" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_assets","arguments":{"q":"skill","kind":"skill","limit":5}}}'

# install_asset（所有安装均需 Authorization: Bearer sk-…）
curl -sS -X POST "$BASE/api/mcp/store" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OPENMCP_API_KEY" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"install_asset","arguments":{"kind":"mcp","id":"<slug>","runtime":"cursor"}}}'
```

Cursor `mcp.json` 片段见 §3.4；Claude Code：`claude mcp add --transport http openmcp-store $BASE/api/mcp/store --header "Authorization: Bearer $OPENMCP_API_KEY"`。

---

## 8. 结构化目录搜索 + AI 选型推荐（Catalog）

> 实现：`apps/web/src/web/catalog/` · Store MCP 复用同一核心 · 迁移 `0007_catalog_assets_search`

### 8.1 目标

统一搜索已上架 **Skill / MCP / A2A / App（workflows）**，默认按热度分排序；Chat / Agent 选型走 `recommend_assets`。

### 8.2 热度分公式

```
hot_score = ln(1 + downloads) * 2.0
          + GREATEST(0, 30 - age_days) * 0.35
          + security_weight   # safe=8, caution=3, unknown=1, else=0
          + (certified ? 5 : 0)
          + (app only) popularity * 0.01
```

Postgres 视图 `catalog_assets` 与 TypeScript `searchCatalog` 使用同一公式（见 migration 注释）。

### 8.3 调用方式

| 入口 | 路径 | 说明 |
|------|------|------|
| tRPC | `catalog.search` / `catalog.recommend` | Web / Chat 后端 |
| Store MCP | `search_assets` / `recommend_assets` | Agent 可匿名调用 |
| SQL | `SELECT * FROM catalog_assets ORDER BY "hotScore" DESC` | 运维 / 报表 |

**Chat 选型示例（Store MCP）**：

```json
{
  "name": "recommend_assets",
  "arguments": {
    "useCase": "帮我找能读写飞书文档的 MCP 或 Skill",
    "kind": "mcp",
    "preferFree": true,
    "securityGrade": "caution",
    "limit": 5
  }
}
```

返回每条含 `reason`（中文推荐理由）与 `hotScore`；选定后再调 `install_asset`（需登录）。

**结构化搜索示例**：

```json
{
  "name": "search_assets",
  "arguments": {
    "q": "飞书",
    "kind": "skill",
    "tags": ["文档"],
    "priceType": "free",
    "sort": "hot",
    "limit": 10
  }
}
```

`q` 现为可选：不传则按过滤器 + 热度浏览。

### 8.4 自动分类（轻量）

Console webhook 入库时：若 payload 带 `category_id` 则写入；否则 `categoryId` 留空。扫描结果为 safe/caution 后异步 `runSkillEnrichment`：LLM 补分类（仅当缺失）、scenario、features，并同步到 `tags`。LLM 失败不阻塞上架。

### 8.5 代码锚点

| 模块 | 路径 |
|------|------|
| DB 视图 / tags | `packages/db/src/catalog-schema.ts` · migration `0007_catalog_assets_search.sql` |
| 搜索核心 | `apps/web/src/web/catalog/search.ts` |
| 选型推荐 | `apps/web/src/web/catalog/recommend.ts` |
| tRPC | `apps/web/src/web/catalog/router.ts` → `catalog.search` / `catalog.recommend` |
| Store MCP | `apps/web/src/lib/agent-install/store-mcp/tools.ts` |

---

## 9. Skill 包安装（SkillHub 对齐，2026-09）

Skill 安装以 **真实 Skill 包（SKILL.md + 文件）** 为主，提示词为辅助。

| 模块 | 路径 |
|------|------|
| 安装说明（Agent 可读） | `public/install/openmcp.md` → `/install/openmcp.md` |
| 包生成 | `src/lib/agent-install/skill-package.ts` |
| Zip / JSON API | `GET /api/skills/[id]/package`（id 可为 uuid、slug，或 `openmcp-store`） |
| 详情 UI | `src/components/agent-install/skill-install-panel.tsx` |

### 详情页按钮层级

1. **复制 prompt**：`请根据 <origin>/install/openmcp.md ，安装 <slug>。`
2. **下载 Zip 包安装**：流式返回含 `SKILL.md` 的 zip（**需登录 / Bearer Key**）
3. **安装到本地 Agent**：展示 Cursor / Claude Code / Codex 目标目录与步骤
4. 折叠：**复制给 Agent 的说明**（旧版长提示词）

### `/start`

主 CTA 为「复制给 AI 安装」短提示词（指向 openmcp.md）；可下载 `openmcp-store` helper zip。

**所有 Skill 下载均需登录**（免费也不例外，见 [SKILL_USER_DOWNLOAD_INSTALL.md §2.1](./SKILL_USER_DOWNLOAD_INSTALL.md#21-新要求-1登录必需login-required-everywhere)）：Web 走 Session Cookie，Agent 走 `Authorization: Bearer <key>` 或 `x-litellm-api-key: <key>`，两者指向 `/api/skills/[id]/package`（该端点同时支持 Bearer / OAuth；`/api/skills/[id]/download` 仅供 Web，会话 Cookie）。MCP / A2A 仍仅平台网关，无 Provider 直连。

