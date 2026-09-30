# Provider OAuth Mode ① — 平台代持授权

> 版本：v1.0
> 实现日期：2026-09-22
> 适用范围：MCP Server 和 A2A Agent 网关接入

## 1. 概述

OAuth Mode ① (平台代持授权) 是一种简化的 OAuth 接入方式，Provider 在连接时完成一次性授权，token 由 LiteLLM 平台持有和管理，Cursor 最终用户只需使用 OpenMCP 网关 API Key 即可调用服务，无需进行个人 OAuth 绑定。

### 1.1 核心特性

- **一次性授权**：Provider 在提交资产时完成授权，后续无需再次授权
- **平台代持**：OAuth token 由 LiteLLM 持有，OpenMCP 不存储敏感 token
- **用户透明**：Cursor 用户无需感知上游 OAuth，使用统一的 API Key 访问
- **中文 UI**：全流程中文界面，符合国内用户习惯

### 1.2 与 Mode ② 的区别

| 特性 | Mode ① (平台代持) | Mode ② (用户个人绑定) |
|-----|------------------|---------------------|
| 授权频率 | 一次（Provider 接入时） | 每个用户一次 |
| Token 持有方 | LiteLLM 平台 | 用户个人 |
| 用户体验 | 无感知，直接使用 API Key | 需要先绑定个人账号 |
| 适用场景 | Provider 代表服务接入 | 用户使用个人账号调用 |
| 实现状态 | ✅ 已实现 | ⚠️ 未实现 |

## 2. 用户流程

### 2.1 MCP Server 接入流程

1. Provider 进入「我的资产 · MCP」→「接入新资产」
2. 填写端点 URL、资产标识等基本信息
3. 在「鉴权方式」中选择**「平台代持授权 (推荐)」**
4. 填写 OAuth 配置：
   - Client ID
   - Client Secret
   - Authorization URL
   - Token URL
   - Scopes (可选)
5. 点击「连接测试」验证端点可达性
6. 测试通过后，显示**授权状态卡片**：
   - 状态：未授权 / 已授权
   - 按钮：「前往授权」/ 「重新授权」
7. 点击「前往授权」，打开上游服务的 OAuth 授权页面（弹窗）
8. 完成授权后，页面回调到 OpenMCP，自动标记为「已授权」
9. 授权完成后，「确认接入网关」按钮解锁
10. 进入 Step 2 填写上架信息（分类、定价、描述、Logo 等）
11. 提交审核

### 2.2 A2A Agent 接入流程

流程与 MCP Server 相同，区别仅在于：
- 入口为「我的资产 · A2A」
- 需要选择协议版本（0.3 / 1.0）
- 回调 URL 为 `/api/oauth/callback/a2a`

### 2.3 授权状态管理

- **未授权**（unauthorized）：显示橙色提示卡片，「确认接入网关」按钮禁用
- **授权中**（authorizing）：弹窗打开后，等待用户完成授权
- **已授权**（authorized）：显示绿色确认卡片，记录授权时间，按钮解锁

## 3. 技术实现

### 3.1 前端实现

**文件**：
- `apps/openmcp/src/components/mcp/submit-mcp-form.tsx`
- `apps/openmcp/src/components/a2a/submit-a2a-form.tsx`

**关键改动**：
1. 新增 `platform_oauth` 认证类型
2. 添加 OAuth 配置字段（authorizationUrl、scopes）
3. 添加 OAuth 状态管理（oauthStatus、oauthAuthorizedAt）
4. 添加授权状态卡片组件
5. 「确认接入网关」按钮根据授权状态禁用/启用
6. 监听 URL 参数 `oauth_success` / `oauth_error` 更新状态

### 3.2 后端实现

#### 3.2.1 类型定义

**文件**：`apps/openmcp/src/lib/gateway/types.ts`

```typescript
export type GatewayAuthUi = 
  | 'none' 
  | 'bearer' 
  | 'api_key' 
  | 'basic' 
  | 'oauth_client'       // Mode ① Client Credentials
  | 'platform_oauth'     // Mode ① Authorization Code (新增)
  | 'custom'

export interface AuthConfigInput {
  type: GatewayAuthUi
  secret?: string | null
  headerName?: string | null
  username?: string | null
  clientId?: string | null
  clientSecret?: string | null
  tokenUrl?: string | null
  authorizationUrl?: string | null  // 新增
  scopes?: string[] | null          // 新增
}
```

#### 3.2.2 数据库 Schema

**文件**：`apps/openmcp/src/db/schema/registry-schema.ts`

```typescript
// mcpServers 和 a2aAgents 表
authType: varchar('auth_type', {
  length: 30,
  enum: ['none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'],
}).default('none')

// authConfig (jsonb) 存储字段：
// - type: 认证类型
// - clientId: OAuth Client ID
// - encrypted_client_secret: 加密后的 Client Secret
// - tokenUrl: Token 端点
// - authorizationUrl: 授权端点
// - scopes: 授权范围数组

// metadata (jsonb) 存储 OAuth 状态：
// - oauthStatus: 'unauthorized' | 'authorized'
// - oauthAuthorizedAt: ISO 8601 时间戳
// - oauthCode: 授权码（临时，用于调试）
```

#### 3.2.3 tRPC 路由

**MCP**：`apps/openmcp/src/web/mcp-servers/router.ts`

```typescript
startOAuth: protectedProcedure
  .input(z.object({
    assetName: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    authorizationUrl: z.string().url(),
    tokenUrl: z.string().url(),
    scopes: z.array(z.string()).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    // 1. 生成 state (base64url 编码的 JSON)
    // 2. 构建授权 URL（带 client_id, redirect_uri, response_type, state, scope）
    // 3. 返回授权 URL 给前端打开
  })

checkOAuthStatus: protectedProcedure
  .input(z.object({ id: z.string() }))
  .query(async ({ ctx, input }) => {
    // 从资产 metadata 读取 oauthStatus 和 oauthAuthorizedAt
  })
```

**A2A**：`apps/openmcp/src/web/a2a-agents/router.ts`（相同结构）

#### 3.2.4 OAuth 回调端点

**MCP**：`apps/openmcp/src/app/api/oauth/callback/mcp/route.ts`
**A2A**：`apps/openmcp/src/app/api/oauth/callback/a2a/route.ts`

```typescript
export async function GET(request: NextRequest) {
  // 1. 接收 code、state、error
  // 2. 解析 state 获取 serverName/agentName 和 authorId
  // 3. TODO: 调用 LiteLLM token exchange API（目前简化为直接标记已授权）
  // 4. 更新数据库 metadata：oauthStatus = 'authorized'
  // 5. 重定向到提交页面，带 oauth_success=1 参数
}
```

#### 3.2.5 LiteLLM 集成

**文件**：`apps/openmcp/src/web/mcp-servers/gateway.ts`、`apps/openmcp/src/web/a2a-agents/gateway.ts`

在 `connect` 方法中，当 `auth.type === 'platform_oauth'` 时：

```typescript
const created = await gw.createServer({
  server_name: serverName,
  url: input.url,
  transport: toLiteLLMTransport(input.transport),
  auth_type: 'oauth2',
  oauth2_flow: 'authorization_code',  // 关键：使用 authorization_code 流
  client_id: input.auth.clientId,
  client_secret: input.auth.clientSecret,
  token_url: input.auth.tokenUrl,
  authorization_url: input.auth.authorizationUrl,
  scopes: input.auth.scopes,
  // ...
})
```

### 3.3 安全考虑

1. **Secret 加密存储**：`clientSecret` 使用 `encryptSecret()` 加密后存储在 `authConfig.encrypted_client_secret`
2. **State 防伪**：OAuth state 使用 base64url 编码的 JSON，包含 `serverName/agentName` 和 `authorId`，回调时验证
3. **回调白名单**：LiteLLM 配置 `MCP_TRUSTED_REDIRECT_ORIGINS` 限制回调域名
4. **HTTPS 强制**：生产环境要求 HTTPS，防止中间人攻击

## 4. Token Exchange 实现细节

### 4.1 OAuth 回调流程

在 `/api/oauth/callback/mcp` 和 `/api/oauth/callback/a2a` 中：

1. **接收授权码**：从 URL 参数获取 `code` 和 `state`
2. **解析 state**：提取 `serverName/agentName` 和 `authorId`
3. **查询资产**：从数据库读取 OAuth 配置（clientId、加密的 clientSecret、tokenUrl）
4. **解密密钥**：使用 `decryptSecret()` 解密 `client_secret`
5. **Token Exchange**：
   ```typescript
   POST {tokenUrl}
   Content-Type: application/x-www-form-urlencoded
   
   grant_type=authorization_code
   &code={authorization_code}
   &redirect_uri={callback_url}
   &client_id={client_id}
   &client_secret={client_secret}
   ```
6. **更新 LiteLLM**：
   - **MCP**: 调用 `updateServer(server_id, { auth_value: access_token })`
   - **A2A**: 调用 `updateAgent(agent_id, { static_headers: { Authorization: 'Bearer {token}' } })`
7. **标记已授权**：更新 OpenMCP 数据库 `metadata.oauthStatus = 'authorized'`
8. **重定向**：返回提交页面 `?oauth_success=1`

### 4.2 错误处理

回调端点在以下情况返回 `oauth_error` 参数：

| 错误码 | 触发场景 | 用户提示 |
|-------|---------|---------|
| `asset_not_found` | 数据库中找不到对应资产 | 资产不存在，请重新提交 |
| `invalid_config` | OAuth 配置缺失 | 配置无效，请检查 OAuth 参数 |
| `decrypt_failed` | client_secret 解密失败 | 密钥解密失败，请联系管理员 |
| `token_exchange_failed` | 上游 token 端点返回错误 | Token 换取失败：{error} |
| `token_request_failed` | 网络请求失败 | 无法连接到 Token 端点 |
| `litellm_update_failed` | LiteLLM API 调用失败 | 更新 LiteLLM 失败，请重试 |

### 4.3 Token 刷新

**当前实现**：不处理 refresh_token，依赖 LiteLLM 自动刷新机制（如果支持）。

**未来增强**：
- 在 OpenMCP 中监听 token 过期事件
- 使用存储的 refresh_token 主动刷新
- 或提示 Provider 重新授权

### 4.4 Provider 资产详情页

在「我的资产」列表中，点击已接入的资产，应显示：
- 授权状态：已授权 / 未授权 / 授权过期
- 授权时间
- 「重新授权」按钮（当授权过期或主动撤销时）

**实现优先级**：P1（Nice-to-have）

### 4.5 错误处理增强

- 上游 OAuth 服务不可用时的用户提示
- Token 刷新失败时的降级策略
- 授权超时（30s 内未完成）的提示

## 5. 与 UED 文档对齐

本实现与 `PROVIDER_GATEWAY_REGISTRATION_UED.md` §5.1（MCP/A2A 接入流程）对齐：

- ✅ Step1 auth 选项包含「平台代持授权 (推荐)」
- ✅ 确认卡显示 auth 状态 + 「前往授权」按钮
- ✅ 「确认接入网关」在未授权时禁用
- ✅ 独立的 MCP 和 A2A 提交表单（非共享 mega-wizard）
- ✅ 复用 LiteLLM 内置 MCP OAuth，OpenMCP 只编排启动和回调

## 6. 环境变量配置

### 6.1 必需环境变量

**OpenMCP (apps/openmcp)**

```bash
# OAuth 回调配置 (必需)
NEXT_PUBLIC_BASE_URL=https://openmcp.example.com

# LiteLLM 连接 (必需)
LITELLM_BASE_URL=https://litellm.example.com

# 密钥加密 (必需，用于加密 client_secret)
GATEWAY_SECRET_KEY=your-long-random-secret-key
# 或复用 BETTER_AUTH_SECRET（两者至少需要一个）
```

**LiteLLM**

如果 LiteLLM 部署在独立服务上，需要配置回调白名单：

```yaml
# config.yaml
general_settings:
  # 允许的 OAuth 回调域名
  allowed_origins:
    - https://openmcp.example.com
```

或通过环境变量：

```bash
# LiteLLM 环境变量（如果支持）
MCP_TRUSTED_REDIRECT_ORIGINS=https://openmcp.example.com
PROXY_BASE_URL=https://litellm.example.com
```

### 6.2 本地开发

```bash
# .env.local
NEXT_PUBLIC_BASE_URL=http://localhost:30021
LITELLM_BASE_URL=http://localhost:4000
GATEWAY_SECRET_KEY=local-dev-secret-key-min-32-chars
```

**注意**：本地开发时，上游 OAuth Provider 需要支持 `http://localhost` 回调地址（大部分 OAuth 服务仅允许 HTTPS）。

## 7. 部署清单

### 7.1 数据库迁移

如果数据库 `authType` 枚举未包含 `platform_oauth`，需要运行迁移：

```sql
-- MCP Servers
ALTER TABLE mcp_servers 
ALTER COLUMN auth_type 
TYPE varchar(30);

-- 更新枚举约束
ALTER TABLE mcp_servers 
DROP CONSTRAINT IF EXISTS mcp_servers_auth_type_check;

ALTER TABLE mcp_servers 
ADD CONSTRAINT mcp_servers_auth_type_check 
CHECK (auth_type IN ('none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'));

-- A2A Agents (同上)
ALTER TABLE a2a_agents 
ALTER COLUMN auth_type 
TYPE varchar(30);

ALTER TABLE a2a_agents 
DROP CONSTRAINT IF EXISTS a2a_agents_auth_type_check;

ALTER TABLE a2a_agents 
ADD CONSTRAINT a2a_agents_auth_type_check 
CHECK (auth_type IN ('none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'));
```

### 7.2 LiteLLM API 调用

**MCP Server Token 更新**：

```typescript
import { getMcpGateway } from '@/lib/litellm'

const gateway = getMcpGateway()
await gateway.updateServer({
  server_id: 'litellm-server-id',
  auth_value: 'access_token_from_oauth'
})
```

**A2A Agent Token 更新**：

```typescript
import { getA2aGateway } from '@/lib/litellm'

const gateway = getA2aGateway()
await gateway.updateAgent('litellm-agent-id', {
  static_headers: {
    Authorization: 'Bearer access_token_from_oauth'
  }
})
```

## 8. 测试指南

### 8.1 手动测试

1. 创建测试 OAuth Provider（可使用 GitHub OAuth App 或自建测试服务）
2. 在 OpenMCP 提交 MCP Server，选择「平台代持授权」
3. 填写测试 OAuth 配置
4. 点击「前往授权」，完成授权流程
5. 验证授权状态卡片变为「已授权」
6. 验证「确认接入网关」按钮解锁
7. 完成上架流程

### 8.2 自动化测试

**TODO**：补充 E2E 测试用例（Playwright）

## 9. 实现状态

### 9.1 已完成 ✅

- OAuth 授权流程（startOAuth → 弹窗授权 → 回调）
- Token Exchange（用 code 换 access_token）
- LiteLLM 集成（updateServer / updateAgent）
- 错误处理（多种错误场景）
- 授权状态管理（authorized / unauthorized）
- 中文 UI（全流程）
- 文档完善

### 9.2 未实现 ⚠️

- Token 自动刷新（依赖 LiteLLM 自动刷新，或需要手动重新授权）
- Provider 资产详情页显示授权状态
- E2E 自动化测试

### 9.3 已知限制

1. **本地开发 OAuth**：大部分 OAuth Provider 不支持 `http://localhost` 回调，需要使用 HTTPS 代理（如 ngrok）或跳过本地 OAuth 测试
2. **Token 刷新**：当 access_token 过期时，需要 Provider 手动重新授权，或依赖 LiteLLM 自动刷新（未测试）
3. **A2A Auth 方式**：A2A 使用 `static_headers` 传递 token，与 MCP 的 `auth_value` 不同

## 10. 版本历史

| 版本 | 日期 | 变更内容 |
|-----|------|---------|
| v1.1 | 2026-09-22 | P0 完成：实现真实 token exchange 和 LiteLLM 集成 |
| v1.0 | 2026-09-22 | 初版，实现 Mode ① 基础功能 |

## 11. 参考资料

- [PROVIDER_GATEWAY_REGISTRATION_UED.md](./PROVIDER_GATEWAY_REGISTRATION_UED.md) - Provider 注册 UED
- [LiteLLM MCP Documentation](https://docs.litellm.ai/docs/mcp)
- [OAuth 2.0 Authorization Code Flow](https://oauth.net/2/grant-types/authorization-code/)
