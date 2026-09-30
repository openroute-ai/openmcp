# API Key 架构：LiteLLM 代理签发 + 本地索引 + 删除同步

> 版本：v1.1（2026-09-28）
> 范围：`apps/openmcp` · Dashboard API Keys、Store MCP 鉴权、Skill 包下载鉴权
> 关联：[LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md)、[AGENT_INSTALL.md](./AGENT_INSTALL.md)、[SKILL_USER_DOWNLOAD_INSTALL.md](./SKILL_USER_DOWNLOAD_INSTALL.md)、[USER_MARKETPLACE.md](./USER_MARKETPLACE.md)、[PROVIDER_GATEWAY_REGISTRATION_UED.md](./PROVIDER_GATEWAY_REGISTRATION_UED.md)

---

## 1. 背景：职责边界

| 组件 | 负责 |
|------|------|
| **LiteLLM**（`api.openmcp.cn`） | 真实网关：市场 MCP / A2A 的运行时入口、Virtual Key、预算与限流、MCP OAuth |
| **OpenMCP**（`www.openmcp.cn`） | Web UI + 资产注册表 + Store MCP（`/api/mcp/store`）+ Skill 包托管（`/api/skills/*`） |

因此「网关调用」与「Skill 下载」两类请求虽然由同一用户在同一个 Agent 里发起，但**服务方不同**：

- 调市场 MCP / A2A → LiteLLM，只认 Virtual Key
- 装 Skill / 注册 Store MCP → OpenMCP，认 Session / API Key / OAuth Token

**问题**：`/dashboard/apikeys` 此前自签发 `omk_…`（仅本地 SHA-256 入库），把它贴进 `{GATEWAY}/{serverName}/mcp` 必然 401，指南链路在第一步就断。

---

## 2. 决策

**一把 key**：Dashboard 签发的就是 LiteLLM Virtual Key（`sk-…`），用户在 Agent 里只贴一次，既能装 Skill / 注册 Store MCP，也能调市场 MCP / A2A。

| # | 决策 |
|---|------|
| 1 | `/dashboard/apikeys` 改为**代理签发**：调用 LiteLLM `POST /key/generate`，openmcp 不再自行生成密钥 |
| 2 | 明文只在创建时返回一次；openmcp 本地存 `sha256(明文)` 作为**索引**，供 Store MCP / Skill 包鉴权使用 |
| 3 | 本地索引同时记录 `key_alias`（LiteLLM 侧别名）与 `key_name`，用于展示与生命周期同步，**不存明文** |
| 4 | 删除必须**先删 LiteLLM 再删本地**；LiteLLM 失败则保留本地行以便重试 |
| 5 | 预算 / 限流 / 模型白名单 / MCP 权限**一律以 LiteLLM 为准**，本地同名字段降级为索引与展示；本地只负责把 `balances` 余额同步成 LiteLLM `max_budget`（见 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md)） |
| 6 | LiteLLM 未配置时：生产环境**拒绝签发**（fail closed），非生产回退自签发并标记 `provider='local'` |

### 2.1 为什么保留本地索引而不是每次调 `/key/info`

`resolveStoreMcpAuth` 在每个 tool call 与每个 `/package` 请求上执行；一次 `install_asset` 往返就是一次远程校验。LiteLLM `POST /key/generate` 返回明文一次且只存自己的 `token`，openmcp 事后无法反查，只能在建 key 时自行落 `sha256(明文)`。这与现有 `api_keys.key` 的用法完全一致，**鉴权链路零改动**。

### 2.2 为什么删除要同步

key 一旦贴进 Agent 配置文件就是长期凭据。若只删本地行，用户在 UI 上以为已吊销，网关侧仍可用 —— 这是真实安全缺口。`POST /key/delete` 支持 `key_aliases`，因此**无需保存明文**即可精确吊销。

---

## 3. 数据模型

`api_keys` 新增三列（migration `0015_api_keys_litellm_index.sql`）：

| 列 | 类型 | 说明 |
|----|------|------|
| `provider` | `varchar(32)` default `'local'` | `litellm` = 网关签发；`local` = 本地回退（仅非生产） |
| `key_alias` | `varchar(256)` | LiteLLM `key_alias`，`/key/delete` 与展示用 |
| `litellm_key_name` | `varchar(256)` | LiteLLM 返回的 `key_name`（token id） |

既有 `key`（`sha256(明文)`）、`start`、`prefix`、`userId` 语义不变；`remaining` / `rateLimitMax` / `requestCount` 保留但不再作为配额真相来源。

---

## 4. 生命周期

### 4.1 创建 `apiKeys.createApiKey`

1. `isLiteLLMConfigured()` 为真：
   - `key_alias = openmcp-<name slug>-<8 位随机 hex>`（保证唯一且可识别来源）
   - `POST /key/generate { key_alias, user_id: ctx.user.id, metadata: { openmcp_key_name }, duration? }`
   - 取回明文 `key`，本地 `sha256(key)` 入 `api_keys.key`，`provider='litellm'`
   - 补偿：网关已签发但本地写入失败、或网关未回传明文时，立即 `POST /key/delete` 吊销该 alias，
     避免出现「网关侧可用、本地查不到」的孤儿凭据
2. 未配置且 `NODE_ENV === 'production'` → 返回失败（不签发打不开网关的 key）
3. 未配置且非生产 → 回退本地自签发，`provider='local'`（面板可见「本地签发」徽标，便于排查）
4. 明文仅在响应中返回一次
5. `input.prefix` 仅对本地回退生效；LiteLLM 自签 `sk-` 前缀，不接受自定义 prefix

### 4.2 校验（鉴权面）

| 端点 | 接受的凭据 |
|------|-----------|
| `/api/mcp/store` | `Authorization: Bearer`、`x-litellm-api-key`、`x-api-key`、OAuth access token |
| `/api/skills/[id]/package` | Session Cookie、`Authorization: Bearer`、`x-litellm-api-key`、OAuth access token |
| `/api/skills/[id]/download` | 仅 Session Cookie（Web 专用，不对 Agent 暴露） |
| `{GATEWAY}/{serverName}/mcp` | LiteLLM：`x-litellm-api-key`（首选）或 `Authorization: Bearer` |
| `{GATEWAY}/a2a/{name}` | 同上 |

`extractBearerToken` 已同时接受 `authorization` 与 `x-litellm-api-key` / `x-api-key`，故一把 key 可在 OpenMCP 与网关两侧复用同一份配置片段。

> `x-litellm-api-key` 的值写**裸 key**（`x-litellm-api-key: sk-...`），不要加 `Bearer `：LiteLLM 只对 `Authorization` 头剥离 `Bearer ` 前缀，自定义头写 `Bearer sk-...` 会导致查库失败。OpenMCP 侧的 `extractBearerToken` 两种写法都能解析，属于更宽松的一侧。

### 4.3 删除 `apiKeys.deleteApiKey`

1. 按 `id + userId` 取本地行；无权限直接失败
2. `provider === 'litellm' && key_alias` → 先 `POST /key/delete { key_aliases: [key_alias] }`
   - 失败 → 返回错误，**保留本地行**（可重试）
3. 删除本地行
4. 仅删本地行成功而网关失败的情况不允许发生

### 4.4 禁用 / 过期

- 本地 `enabled=false` 只影响 OpenMCP 侧解析；如需同时禁用网关侧，走 LiteLLM `POST /key/block`（后续迭代，当前 UI 无禁用入口）
- 本地 `expiresAt` 仍生效；创建时同步把天数传给 LiteLLM `duration`，两侧同时到期

---

## 5. 文案与文档联动

| 位置 | 要求 |
|------|------|
| `/dashboard/apikeys` | 说明「这是网关 Virtual Key，可用于 MCP / A2A / Skill 安装」 |
| `/install/openmcp.md` | 明确「所有 `/package` 下载需登录或带 Key」，删除「免费可匿名」说法；curl 示例带鉴权头 |
| `AGENT_INSTALL.md` §4 | 网关鉴权头写 `x-litellm-api-key`（首选） |
| `/start` 提示词 | 网关片段用 `x-litellm-api-key`；Store MCP 片段保留 `Authorization` |

---

## 6. 非目标

- ❌ 拆分「安装 key / 调用 key」两把凭证（保持一把）
- ❌ 每次请求实时调 LiteLLM `/key/info` 校验
- ❌ 在 openmcp 侧实现请求级预算 / 限流（与 LiteLLM 重复）；openmcp 只负责**把余额同步成 `max_budget`**，拦截由 LiteLLM 执行
- ❌ 消费回写（把 LiteLLM 花费扣回 `balances`）与 MCP/A2A Provider 分成 —— 阶段二，见 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md) §6
- ❌ OpenMCP 与 LiteLLM 之间的货币换算（数值直传，见 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md) §1）
- ❌ Refresh Token（沿用 [SKILL_USER_DOWNLOAD_INSTALL.md](./SKILL_USER_DOWNLOAD_INSTALL.md) §P2+ 标记）

---

## 7. 验收

1. 生产环境创建 Key 返回 `sk-…`，且该 Key 可直接用于 `{GATEWAY}/{name}/mcp`
2. 同一 Key 可访问 `/api/mcp/store`（`install_asset`）与 `/api/skills/<slug>/package`
3. 删除 Key 后，LiteLLM 侧 `POST /key/delete` 被调用，本地行随之消失
4. LiteLLM 不可用时生产环境创建失败，非生产回退且 `provider='local'` 可见
5. 明文 Key 不落库（仅 `sha256`）
6. 新签发的 Key 自带 `max_budget`（余额为 0 时为 `blocked`），预算口径见 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md)

> ⚠️ `§4.4` 里「走 LiteLLM `POST /key/block`」对**预算**字段（`max_budget` / `blocked`）已由 [LITELLM_BUDGET_SYNC.md](./LITELLM_BUDGET_SYNC.md) 落地：余额耗尽自动 `blocked: true`，充值后自动解除。但 `enabled=false` 仍只影响 OpenMCP 侧，**用户主动禁用网关 Key** 的 UI 入口依然没有开放。

---

## 8. 代码锚点

| 模块 | 路径 |
|------|------|
| 表结构 | `src/db/schema/auth-schema.ts`（`apiKeys`） |
| 迁移 | `migrations/0015_api_keys_litellm_index.sql` |
| LiteLLM Key 管理 | `src/lib/litellm/virtual-keys.ts`（`generateKey` / `deleteKeys`） |
| tRPC | `src/server/routers/web/apiKeys.ts` |
| 鉴权解析 | `src/lib/agent-install/store-mcp/auth.ts`（`extractBearerToken` / `resolveStoreMcpAuth`） |
| Skill 包鉴权 | `src/app/api/skills/[id]/package/route.ts` |
| 网关 URL / 鉴权头 | `src/lib/agent-install/urls.ts` |
