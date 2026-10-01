# `apps/console` Radar 开放 API 设计方案

> 本文定义 `apps/console` 对外开放的 HTTP API：API Key 的创建与签发、仓库创建与首次拉取回调、
> 指定仓库的日/周/月统计、周期排行与周期目录、以及日更新订阅推送。
>
> 前提事实（已核对代码）：
>
> - `apps/console` 与 `apps/web` 是两个独立 Next 应用，各自的数据库、账号体系、会话与鉴权互不相通。
>   本文所有接口只经HTTP 与外部通信，**不得** import `@workspace/db` / `@workspace/auth`，
>   也不共享任何用户身份。
> - 仓库创建已存在于 `apps/console/src/lib/trpc/routers/repos.ts:389`（`repos.create`），
>   统计写入已存在于 `apps/console/src/lib/github/service/stats.ts:434`（`recordCurrentPeriods`），
>   排行构建已存在于 `apps/console/src/lib/github/service/rankings.ts`（`buildRankingsForWeek` /
>   `buildRankingsForMonth`）。
> - 三张统计表 `repo_daily_stats` / `repo_weekly_stats` / `repo_monthly_stats` 由
>   `apps/console/src/db/drizzle/0012_repo_stats.sql` 建出，字段完全一致；`repo_stargazers`
>   同批建立。
> - 现有机器对机器鉴权只有一个 `CONSOLE_API_TOKEN`（`apps/console/src/lib/env.ts:157`，
>   `apps/console/src/app/api/internal/repos/route.ts`），常数时间比较、fail-closed 404。
>   本文的设计把它升级为可撤销的 key，但**保持同样的 fail-closed 语义**。
> - 现有出站签名实现在 `apps/console/src/lib/webhook/client.ts`（`signPayload` /
>   `verifySignature` / `isFreshTimestamp` / `sendWebhook`），本文的回调与订阅推送复用它，
>   不另造一套签名。
> - `apps/web` 的 `repo_snapshots.subscribers`（`packages/db/src/mcp-schema.ts:100`）当前**从未被写入**，
>   且 `repo_snapshots.watchers` 拿到的是 REST 的 `watchers_count`。GitHub 这两个字段的语义与直觉相反，
>   见 §4.4。结论是 console 侧**不需要新增计数器**，但必须先讲清这个坑。

---

## 1. 总览

### 1.1 路由清单

所有开放接口挂在 `/api/v1` 前缀下，与匿名可读的 `/api/rankings/*.json` 并存但互不影响。

| 方法 | 路径 | scope | 说明 |
|---|---|---|---|
| POST | `/api/v1/repos` | `repos:write` | 创建仓库（异步或同步），可选首次拉取完成回调 |
| GET | `/api/v1/repos` | `repos:read` | 列出该 key 可见的仓库，支持 §6.6 的同一套过滤器 |
| GET | `/api/v1/repos/{id}` | `repos:read` | 单个仓库档案 + 最近一期统计 |
| GET | `/api/v1/repos/{id}/stats` | `repos:read` | 日/周/月区间统计（§4） |
| GET | `/api/v1/rankings/weekly` | `rankings:read` | 指定周排行 |
| GET | `/api/v1/rankings/monthly` | `rankings:read` | 指定月排行 |
| GET | `/api/v1/rankings/periods` | `rankings:read` | 可用周期目录（周/月，按年过滤） |
| POST | `/api/v1/subscriptions` | `subscriptions:write` | 创建订阅（§6） |
| GET | `/api/v1/subscriptions` | `subscriptions:write` | 列出当前主体的订阅 |
| GET | `/api/v1/subscriptions/{id}` | `subscriptions:write` | 单个订阅详情 + 命中仓库 + 投递状态 |
| PATCH | `/api/v1/subscriptions/{id}` | `subscriptions:write` | 改过滤器 / scopes / 暂停 / 恢复 |
| DELETE | `/api/v1/subscriptions/{id}` | `subscriptions:write` | 删除订阅并清空待投递队列 |
| POST | `/api/v1/subscriptions/{id}/rotate-secret` | `subscriptions:write` | 轮换回调 secret |
| POST | `/api/v1/subscriptions/{id}/test` | `subscriptions:write` | 立刻发一条探测 payload，验证回调可达 |
| GET | `/api/v1/openapi.json` | 任意有效凭据 | 接口自描述（§8） |

订阅也可以由 console 登录用户在 `/dashboard/subscriptions` 自助创建，归属主体是该账号而不是某个
API key。两套管理入口共用同一个 `createSubscription` 服务函数（§6.7）。

### 1.2 不做什么

| 不提供 | 原因 |
|---|---|
| `repo_stargazers` 明细 | GitHub 对非仓库管理员的 `/stargazers` 返回 403，覆盖必然不完整，对外给出会造成"完整"的错误印象。仅作为内部留存（`0012` 的注释已说明）。 |
| console 用户身份 | 跨应用不共享账号。`userRepos.userId` 只用于 console 内部的提交归属，M2M 提交走 `source: "api"`。 |
| radar 排行写入 web 的 workflow rankings | 已在 `CONSOLE_RADAR_COMMERCIAL_PLAN.md` §7.3 决策：两套排行独立，radar 排行是"信号"，web 排行是"行为"。 |
| 发布 / 扫描门控 | 那是 web 侧职责（`SKILLS_PUBLISH_POLICY.md`）。console 只提供证据。 |

### 1.3 不变约束

- 统计周期的"日 / 周 / 月"一律按 `Asia/Shanghai`（`apps/console/src/lib/time.ts` 的
  `APP_TIMEZONE`）解释。`period` 是该日历边界对应的**瞬间**，不是 UTC 零点。
- `total_*` / `delta_*` 的 `NULL` 原样透传，**不转 0**。`NULL` 的含义是"该周期未采集"，
  转0 会变成"采集到 0"。
- `deltaNewStars`（毛新增）与 `deltaStars`（净变化）是两个不同的量，保留两者。
- 所有响应带 `Cache-Control` / `ETag`（读接口）或 `no-store`（写接口、回调、订阅）。

---

## 2. API 创建与签发

### 2.1 为什么不用单token

现有 `CONSOLE_API_TOKEN` 能回答"能不能调"，但回答不了：

- **谁在调** —— 泄漏后无法定位来源，也无法只吊销受影响的调用方。
- **能调什么** —— 读仓库和创建仓库共用一个凭据，权限无法分层。
- **配额归谁** —— 限流、审计、账单都需要一个主体。

同时 §1.1 里 `apps/web` 是唯一的计划消费方，若它需要轮换凭据，共享单 token 会让轮换变成一次
全站风险操作。

### 2.2 表结构

```sql
-- 0015_api_keys.sql
CREATE TABLE "api_keys" (
  "id"             text PRIMARY KEY,
  -- 只存 sha256(明文)，明文仅在创建响应里出现一次。
  -- 与 docs/design/API_KEY_LITELLM_PROXY.md 的 api_keys.key 同一做法。
  "key_hash"       text NOT NULL,
  -- 明文的前 8 字符，用于 UI 展示和人工比对，不足以被用来鉴权。
  "prefix"         text NOT NULL,
  "name"           text NOT NULL,
  -- 归属账号。console 自己的 user 表，不对外暴露。
  "created_by"     text REFERENCES "user"("id") ON DELETE SET NULL,
  -- 该key 提交仓库时，userRepos 记谁。用它，repos.created_by 不动。
  "submitter_id"   text REFERENCES "user"("id") ON DELETE SET NULL,
  "scopes"         text[] NOT NULL,
  "rate_limit_rpm" integer NOT NULL DEFAULT 60,
  "rate_limit_rpd" integer NOT NULL DEFAULT 5000,
  "expires_at"     timestamp with time zone,
  "revoked_at"     timestamp with time zone,
  "revoked_reason" text,
  "last_used_at"   timestamp with time zone,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone
);
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" ("key_hash");
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" ("created_by");
-- 列"未吊销且未过期"的 key。过期要 `IS NULL OR > now()`，因为 NULL 表示不过期。
CREATE INDEX "api_keys_active_idx" ON "api_keys" ("revoked_at","expires_at");
```

`key_hash` 用 **sha256** 而不是 bcrypt / argon2，与 `API_KEY_LITELLM_PROXY.md` 保持一致：
key 是高熵随机串，不需要抗离线爆破的可逆性检查；用慢哈希会让每次 API 调用都付出百毫秒级延迟。
这里防的是"数据库泄漏后直接拿到明文"，不是"防猜"。

### 2.3 明文格式与生成

```
mcp_radar_<prefix>_<secret>
         ~~~~~~~~  ~~~~~~~~~~~~~~~~
         展示用     一次性返回的机密部分
```

- `secret` = `randomBytes(32).toString("base64url")`（256 bit 熵）
- `prefix` = `randomBytes(3).toString("base64url")`（4字符），用于 `api_keys.prefix`
- 明文整体再做一次 `sha256` 存 `key_hash`

前端必须按 `sk-` 之外的惯例自行剥前缀。**约定：Bearer 值就是完整明文，不带 `Bearer ` 之外的任何包装**。

### 2.4 签发入口

签发本身**不是**开放 API —— 否则任何人都能给自己发 key。签发走 console 的 tRPC：

```
apiKeys.create     adminProcedure
apiKeys.list       adminProcedure
apiKeys.revoke     adminProcedure
apiKeys.rotate     adminProcedure
```

理由：谁有权给别人发凭据，是账号系统的事，不是开放 API 的事。这也符合"console 保持账号独立"
的约束 —— 签发不需要 web 参与。

```ts
apiKeys.create.input({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  submitterId: z.string().nullable().optional(),   // 提交仓库时记到谁名下
  expiresAt: z.coerce.date().nullable().optional(),
  rateLimitRpm: z.number().int().min(1).max(1000).optional(),
})
// 输出：{ id, prefix, name, scopes, ..., secret?: string }  ← secret 只在 create/rotate 出现
```

`secret` 出现在响应里，也出现在该响应的 `Cache-Control: no-store` 里。之后任何读接口都不再返回它，
包括 `apiKeys.list`。

### 2.5 scope 枚举

| scope | 允许 |
|---|---|
| `repos:read` | `GET /api/v1/repos*`、`GET /api/v1/repos/{id}/stats` |
| `repos:write` | `POST /api/v1/repos` |
| `rankings:read` | `GET /api/v1/rankings/*` |
| `subscriptions:write` | `/api/v1/subscriptions` 的全部方法 |

scope 是**加法**的：`repos:read` 不含 `repos:write`，`subscriptions:write` 不隐含任何读权限。
一条 key 想读又想订阅，就得显式列两个。

订阅隐含的读能力由服务端按订阅的 `scopes` 自行读库，**不复用调用方的 key** —— 见 §5.3。

### 2.6 请求鉴权流程

```ts
// apps/console/src/lib/api/guard.ts（新增）
export type ApiKeyPrincipal = {
  keyId: string
  scopes: ReadonlySet<ApiScope>
  submitterId: string | null
}

export async function authenticateApiKey(request: Request): Promise<
  { ok: true; principal: ApiKeyPrincipal } | { ok: false; response: Response }
>
```

顺序（任一步失败立即返回，不继续查库）：

1. 取 `Authorization: Bearer <明文>`。缺失/格式错 → 401。
2. `sha256(明文)` → 查 `api_keys.key_hash`。
3. 查不到 → **404**（不是 401）。与现有 `apiToken()` 的 fail-closed 一致：
   一个没配置凭据的实例不该通过 401 vs 404 的差别告诉攻击者这条路由存在。
4. `revoked_at IS NOT NULL` → 401 `key_revoked`。
5. `expires_at < now()` → 401 `key_expired`。
6. `scopes` 不含所需 scope → 403 `insufficient_scope`，并带 `WWW-Authenticate:
   Bearer error="insufficient_scope"`。
7. 限流（§2.8）：先过每分钟窗口，再过每日窗口。超限 → 429 + `Retry-After`。
8. 通过后更新 `last_used_at`（异步、不阻塞响应、失败只记日志），并把 `api_keys.id` 记入
   审计日志。

### 2.7 吊销与轮换

- **吊销**：`revoked_at` 置位，立即生效（下一个请求就 401），无缓存可清。
- **轮换**：`apiKeys.rotate` 创建一个 `scopes` / `rate_limit_*` 相同、`revoked_at` 已置位的新 key，
  返回新明文一次。旧 key 立即死。
  理由：轮换不应该需要"先创建新的、再手工删旧的"，那个中间窗口会让两个有效凭据同时存在。

### 2.8 限流：本地 Redis + Vercel Upstash

**先说清楚为什么不能靠进程内计数。** Vercel 的函数实例是按流量冷启动、无状态的：
同一个 key 的连续两次请求很可能落在两个不同实例上，进程内窗口等于每个实例各发一份配额。
再叠上 `notify-subscriptions` 这个任务——它本身就要防多实例并发执行同一个 sweep——
单实例假设已经不成立了。所以限流和分布式锁一起上 Redis。

**驱动选择按环境变量决定，两者实现同一个接口：**

| 变量 | 场景 | 客户端 |
|---|---|---|
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`，或 `REDIS_URL` | 本地开发 / 自建 | `ioredis`（console 已在依赖里，见 `packages/sms-captcha/src/server/redis.ts` 的同一套约定） |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Vercel | `@upstash/redis`（需新增依赖） |

沿用 monorepo 已有的 `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_DB` 命名而不是新造
`REDIS_URL`，是为了让 console 和 `@workspace/sms-captcha` 用同一份本地 Redis 配置；
`REDIS_URL` 额外支持，因为托管 Redis 通常只给一个连接串。

`KV_REST_API_*` 存在时优先使用 Upstash；两者都没有时，限流降级为进程内窗口并**打一条
`logger.warn`**——本地开发不该因为没起 Redis 而 503。

```ts
// apps/console/src/lib/redis/client.ts（新增）
export interface RedisLike {
  eval<T = unknown>(script: string, keys: string[], args: string[]): Promise<T>
  set(key: string, value: string, opts?: { nx?: boolean; px?: number }): Promise<"OK" | null>
  del(key: string): Promise<number>
}
```

只暴露三个原语。刻意不暴露整个 redis 客户端：接口越小，两种驱动的行为差异越无处藏身，
将来换驱动的成本也就越低。`@upstash/redis` 的 `eval(script, keys, args)` 与 node-redis 的
`eval(script, { keys, arguments })` 签名不同，在这层抹平。

**滑动窗口用一段 Lua，一次往返完成"清理 + 计数 + 判定"。** 多条命令（`ZREMRANGEBYSCORE`
→ `ZCARD` → `ZADD`）分开发会有竞态：一个并发的请求会在 `ZCARD` 之后、`ZADD` 之前
数到一个偏小的值，于是两个请求都以为自己还在配额内。Lua 脚本在 Redis 里是原子的，
所以本地和 Upstash 都能跑同一段。

```lua
-- apps/console/src/lib/redis/lua/sliding-window.lua
-- KEYS[1] = 窗口 zset 的 key
-- ARGV[1] = now (ms)   ARGV[2] = window (ms)   ARGV[3] = member (唯一)
-- ARGV[4] = limit      ARGV[5] = ttl (s)
local key, now, window, member, limit, ttl =
  KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local used = redis.call('ZCARD', key)
if used >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = window
  if oldest[2] then retryAfterMs = (tonumber(oldest[2]) + window) - now end
  return { 0, used, retryAfterMs }
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return { 1, used + 1, 0 }
```

返回三元组 `{allowed, used, retryAfterMs}`，两个驱动都原样透传，因此限流判定逻辑
只需要写一次、测试一次。

`member` 用 `apiKeyId + ":" + 一个每次请求唯一的值`。若用 `apiKeyId` 本身，
同一 key 的并发请求会写同一个 member，`ZCARD` 少算、限流失效。

**两个窗口：**

| 窗口 | key | limit | TTL |
|---|---|---|---|
| 每分钟 | `rl:rpm:<apiKeyId>:<YYYYMMDDHHMM>` | `api_keys.rate_limit_rpm` | 120s |
| 每日 | `rl:rpd:<apiKeyId>:<YYYYMMDD>` | `api_keys.rate_limit_rpd` | 172800s |

每日窗口用固定窗口（key 里带日期）而不是滑动窗口：跨天的限流用不着秒级精确，
而固定窗口少一次 Lua 调用、key 可以自然过期、不需要清理。

**Redis 不可用时的行为：fail-open。** 拿到限流结果超限以外的异常（连接失败、超时、
脚本报错），一律放行并打 `logger.warn`。理由：限流是保护措施，不是正确性措施——
Redis 抖一下就让整个 API 变成 500，是拿可用性换了一个本来就不是安全边界的功能。
真的需要硬边界的地方（比如防止暴力尝试）应该单独走一条 fail-closed 路径，
而不是让所有读接口一起被拖垮。

**分布式锁（同一套 Redis，顺手做掉）：**

```
SET notify-subscriptions:lock <instanceId> NX PX 900000
```

`notify-subscriptions` 拿到锁才跑，跑完 `DEL`。900s 是任务最长预估时长的 1.5 倍；
超时自动释放，避免实例被杀后锁永远不还。
这个锁和 `task_alreadyRunning`（`apps/console/src/lib/tasks/runner.ts` 里的进程内重入保护）
是**两层**，不冲突：前者防跨实例，后者防同一实例内的重入。

### 2.9 第三方接入的形态

保留 `mode: "snapshot"`（§6.4）——第三方接入是已知方向，`batch` 的水位线语义对
"只要一份当前快照"的接入方是纯粹的负担。

配套的三件事：

1. **`GET /api/v1/openapi.json`** 生成完整 spec，由 zod schema 单一来源产出（§8）。
2. **分层的 rate limit**：第三方默认比内部 key 更严（如 `rate_limit_rpm = 30`），
   由签发时的 `tier` 字段决定，而不是让每个 key 手填数字。
3. **key 的自助签发还是 admin 签发**——见 §12 待确认 #1。这是第三方接入的**唯一硬门槛**：
   admin 手动为每个第三方发 key 在早期可行，第三方一多就不成立了。

---

## 3. 仓库创建与首次拉取回调

### 3.1 复用与差异

`repos.create`（`apps/console/src/lib/trpc/routers/repos.ts:389`）已经做对了大部分事：
`parseGithubRepoUrl` → `fetchRepoInfo` → `upsertRepo` → `setRepoCreatedBy` → `linkUserToRepo`
→ `recomputePlatformStates`。

开放 API 版本**不重写这套逻辑**，而是把同一段序列抽成
`apps/console/src/lib/github/service/ingest-repo.ts` 的 `ingestRepo(db, { url, source, submitterId })`，
由 tRPC 和 REST 两条入口共用。差异只有一处：

**M2M 提交不写 `repos.created_by`。**

`repos.createdBy` 的语义是"这个仓库属于某个账号"（`apps/console/src/db/schema/github.ts:139`），
`/console` 的"我的仓库"列表直接过滤这一列。一个外部系统的 API key 不是账号，
让 web 的提交在 console 里冒名成某个用户是错的。而 `userRepos.source` 枚举里已经有 `"api"`
（`apps/console/src/db/schema.ts:243`），那才是 M2M 提交的正确落点。

若 key 带 `submitterId`，`userRepos.userId` 记该用户（前端可选择把用户提交的仓库集中到一个人名下），
`repos.created_by` 仍不动。

### 3.2 请求

```http
POST /api/v1/repos
Authorization: Bearer mcp_radar_xxx_yyy
Content-Type: application/json
Idempotency-Key: <可选，客户端生成的稳定字符串>
```

```jsonc
{
  "repository": "owner/name",            // 或完整 GitHub URL
  "clientRef": "web-repo-1024",          // 可选，原样回传
  "callbackUrl": "https://…",            // 可选
  "callbackSecret": "…",                 // 可选，不传则用 key 派生的 secret
  "wait": false                          // 可选，默认 false
}
```

`wait: true` 时同步等待首次拉取完成并直接返回统计（最多阻塞 30s，超过则退回异步语义 + 202）。
这是给"提交后立刻想看到数据"的小客户端的便利开关，不是保证。

### 3.3 幂等

- `Idempotency-Key` 头存在时，在 `api_request_idempotency` 表记
  `(key_hash, idempotency_key, request_fingerprint, response_status, response_body, created_at)`。
- 同 key + 同 fingerprint → 直接回放上次响应。
- 同 key + 不同 fingerprint → `409 idempotency_key_reuse`。
- 24 小时后过期清理。
- 未带该头时，天然幂等：`upsertRepo` 本身按 `(owner, name)` 冲突更新，重复提交同一 URL 只是刷新。
  所以**不带该头也不会产生重复行**，只是响应里的 `created` 字段会从 `true` 变 `false`。

### 3.4 响应

```jsonc
// 202，异步（wait=false，或 wait=true 但超时）
{
  "requestId": "req_abc123",
  "repoId": "V1StGXR8Z5jd",
  "fullName": "owner/name",
  "status": "queued",
  "created": true,
  "clientRef": "web-repo-1024"
}

// 200，同步且当天已 fetch 过
{
  "requestId": "req_abc123",
  "repoId": "V1StGXR8Z5jd",
  "fullName": "owner/name",
  "status": "ready",
  "created": true,
  "stats": { "daily": {...}, "weekly": {...}, "monthly": {...} }
}
```

### 3.5 首次拉取回调

`callbackUrl` 给了就走异步，console 在 `ingestRepo` 成功后回调一次；失败也回调一次。

**签名**：复用 `signPayload`（`apps/console/src/lib/webhook/client.ts:63`）。

```
X-Webhook-Timestamp: 1774000000
X-Webhook-Signature: sha256=<hex over "<timestamp>.<raw body>">
```

验签方（`apps/web`）三步，缺一不可：

1. `verifySignature(rawBody, ts, secret, header)` —— 必须用**收到的原始字节**，
   重新 `JSON.stringify` 会改键序导致验签失败（`signPayload` 的注释已写明这一点）。
2. `isFreshTimestamp(ts, new Date(), 300)` —— 只验 HMAC 的接收方会永远接受被录制的请求，
   时间戳窗口是签名有意义的前提。
3. `eventId` 去重 —— 网络重试会让同一个事件到达两次，按 `eventId` 落一张幂等表。

请求头：

```
Content-Type: application/json
X-Webhook-Id: evt_abc123          ← 幂等键，重试不变
X-Webhook-Timestamp: 1774000000
X-Webhook-Signature: sha256=...
X-Webhook-Event: repo.initial_pull.completed
```

secret 来源优先级：`callbackSecret`（本次请求带的）> `api_keys` 派生 secret（见 §4.3）> `CONSOLE_API_TOKEN`。

### 3.6 payload

```jsonc
{
  "eventId": "evt_abc123",
  "event": "repo.initial_pull.completed",
  "deliveredAt": "2026-04-01T18:00:03.114Z",
  "requestId": "req_abc123",
  "clientRef": "web-repo-1024",
  "repo": {
    "id": "V1StGXR8Z5jd",
    "fullName": "owner/name",
    "owner": "owner", "ownerId": 12345, "name": "name",
    "repoUrl": "https://github.com/owner/name",
    "description": "…", "homepage": "…",
    "topics": ["mcp"], "languages": ["TypeScript"],
    "licenseSpdxId": "MIT",
    "defaultBranch": "main", "archived": false,
    "stars": 1234, "forks": 120,
    "subscribersCount": 89,                  // GitHub watchers，见 §4.4
    "contributorCount": 34, "commitCount": 890,
    "mentionableUsersCount": 12,
    "openIssuesCount": 7,
    "pullRequestsCount": 15, "releasesCount": 9,
    "createdAt": "2024-01-01T00:00:00Z",
    "pushedAt": "2026-03-30T12:00:00Z",
    "lastCommit": "2026-03-30T11:59:00Z",
    "latestReleaseName": "v1.2.0",
    "latestReleaseTagName": "v1.2.0",
    "latestReleasePublishedAt": "2026-03-01T00:00:00Z",
    "latestReleaseUrl": "https://github.com/owner/name/releases/tag/v1.2.0",
    "openGraphImageUrl": "…",
    "iconUrl": "…",                          // 可为 null，取决于 icon 任务是否跑过
    // §6.6 的过滤器命中情况。订阅推送也带同一份，客户端的过滤逻辑可以复用。
    "classification": {
      "projectTypes": ["skill"],
      "isPlatformProject": true,
      "platformStatus": "curated",
      "tags": ["mcp", "agent"]
    }
  },
  "stats": {
    "daily":   { /* §4.1 的单期对象 */ },
    "weekly":  { /* … */ },
    "monthly": { /* … */ }
  },
  "meta": {
    "taskName": "repos.create",
    "processedAt": "2026-04-01T18:00:03.114Z",
    "processingTimeMs": 1420,
    "success": true
  }
}
```

失败：

```jsonc
{
  "eventId": "evt_abc124",
  "event": "repo.initial_pull.failed",
  "requestId": "req_abc123",
  "clientRef": "web-repo-1024",
  "error": {
    "code": "github_repo_not_found",   // 或 github_forbidden / github_rate_limited / github_unreachable
    "message": "GitHub returned 404 for owner/name"
  },
  "meta": { "success": false, "taskName": "repos.create" }
}
```

**HTTP 状态码恒为 2xx**（含失败事件），`success` 在 payload 里。
理由：让消费方按状态码做重试决策，等于让"GitHub 仓库是私有的"和"你的服务炸了"走同一条重试路径，
把一个永久失败重试到天荒地老。失败事件由消费方按 `error.code` 自己决定要不要告警。

可重试与不可重试在 console 侧也分开：失败回调只投递一次，不重试——因为 §3.5 已经把状态码从重试
语义里解耦了，再加重试只是放大"永久失败"。

**明确不含 `repo_stargazers` / stargazer 明细。** 也不含 `readmeContent`（可能是几 MB，
且 radar 不做 README 托管）。

---

## 4. 仓库统计读取

### 4.1 `GET /api/v1/repos/{id}/stats`

`{id}` 接受 console 的 `repos.id`（nanoid）或 `owner/name`（URL 编码为 `owner%2Fname`）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `cadence` | `daily` | `daily` \| `weekly` \| `monthly` |
| `start` | `end - 90d` | ISO 8601，按 `Asia/Shanghai` 日历解释 |
| `end` | 该仓库最新已存周期 | **不clamp 到今天** |
| `limit` | 500 | 1..1000 |
| `cursor` | — | 上一页的 `nextCursor` |

**为什么默认 90 天**：沿用 `stats.ts:960` 的 `DAILY_ARRIVALS_WINDOW_DAYS`，
和公开项目详情图用同一个窗口，客户端不需要为 radar 和详情页维护两套默认。

**为什么 `end` 是"最新已存周期"而不是今天**：`listDailyArrivals`
（`apps/console/src/lib/github/service/stats.ts:891`）的注释已经论证过这一点 —— sweep 随时可能停，
sweep 最后一次跑可能是三天前。按日历今天取，返回的是一串"有数据的最后一天 → 今天"的空洞，
而空洞在日频图上和"这几天真的没人 star"无法区分。

响应：

```jsonc
{
  "repoId": "V1StGXR8Z5jd",
  "fullName": "owner/name",
  "cadence": "daily",
  "timezone": "Asia/Shanghai",
  "range": {
    "start": "2026-01-01T16:00:00Z",
    "end":   "2026-03-31T16:00:00Z"
  },
  "counts": { "periods": 90, "returned": 90, "hasMore": false },
  "periods": [
    {
      "period": "2026-03-31T16:00:00Z",
      "date": "2026-04-01",          // daily: Asia/Shanghai 日历日
      "yearWeek": "2026-W14",        // weekly: ISO 周
      "yearMonth": "2026-03",        // monthly: 年月
      "totalStars": 1234, "deltaStars": 40, "deltaNewStars": 46,
      "totalWatchers": 89,   "deltaWatchers": 2,
      "totalForks": 120,     "deltaForks": 3,
      "totalOpenIssues": 7,  "deltaOpenIssues": -2,
      "totalPullRequests": 15, "deltaPullRequests": 1,
      "totalReleases": 9,    "deltaReleases": 1,
      "totalContributors": 34, "deltaContributors": 0,
      "totalCommits": 890,   "deltaCommits": 25,
      "totalDownloads": 12000, "deltaDownloads": 300
    }
  ],
  "nextCursor": "…"
}
```

- 三个周期标签字段恒定输出（不适用的为 `null`），让客户端不必按 `cadence` 分支解析。
- `NULL` 原样输出为 `null`。
- 稠密行：schema 层保证每个周期都有一行（`github.ts:449` 的注释：dense rows 让"没发生"
  成为一个明确的 0 而不是需要猜的空洞），所以接口层不再补洞。
- `totalDownloads` 对非 npm 仓库恒为 `null`。这是 `NULL` 语义最典型的用例：
  "没有下载数据"和"下载数是 0"是两件事。

### 4.2 需要新增的服务函数

现有 `listRecentDailyStats` / `listRecentWeeklyStats`（`stats.ts:329`/`348`）是"倒序取最近 N 期"，
语义与"任意区间"不同，**不能直接套**。新增：

```ts
// apps/console/src/lib/github/service/stats.ts
export interface StatsRange {
  start: Date
  end: Date
  limit: number
  cursor?: { period: Date; repoId: string }
}

export async function listStatsRange(
  db: Db,
  repoId: string,
  cadence: StatsCadence,
  range: StatsRange
): Promise<StatsRow[]>

export async function listStatsSince(
  db: Db,
  cadence: StatsCadence,
  since: Date,
  repoIds?: string[]
): Promise<Array<{ repoId: string; row: StatsRow }>>
```

`listStatsSince` 供订阅增量推送使用（§6.4），按 `period > since` 索引扫描，
三张表都有 `period` 单列索引（`0012` 建出）。

### 4.3 callback secret 的派生

未显式传 `callbackSecret` 时，用 key 派生而不是用 key 明文本身：

```
secret = base64url( HMAC-SHA256( key="mcp-radar-callback-v1", message=sha256(apiKeyHash) ) )
```

这样做的收益是**回调 secret 可独立吊销**（换 key 即换 secret），且回调接收端泄露 secret 不会
反推出调用用的 API key。派生输入用 `key_hash` 而非明文，是为了让派生过程不需要在请求路径上
持有明文。

### 4.4 `subscribers`（GitHub watchers）：语义澄清与结论

需求里问的 `apps/web` 的 `repo_snapshots.subscribers`（`packages/db/src/mcp-schema.ts:100`），
**GitHub 确实提供，而且 console 侧已经在存了**。但这里有一个极易踩的坑，先把 GitHub 的两套命名对齐：

| GitHub 概念 | REST 字段 | GraphQL 字段 | 含义 |
|---|---|---|---|
| Stargazers（收藏） | `stargazers_count`（`watchers_count` / `watchers` 是它的**历史别名**） | `stargazers` | 给仓库点 star 的人 |
| Watchers / Subscribers（订阅） | `subscribers_count` | `watchers` | 订阅了仓库通知的人（**不**包含 star） |

GitHub 官方文档的原话：*"In responses from the REST API, `subscribers_count` corresponds to the
number of watchers, whereas `watchers`, `watchers_count`, and `stargazers_count` correspond to the
number of users that have starred a repository."*

**两套 API 里"watchers"这个词指的是相反的东西**：

- REST 的 `watchers_count` = **star 数**（一个会误导人的遗留别名）
- GraphQL 的 `watchers` connection = **订阅数**（对应 REST 的 `subscribers_count`）

GraphQL 里**没有** `subscribers` 字段 —— 想知道订阅数，GraphQL 得查 `watchers`。

**结论：console 侧不需要新增计数器，也不需要迁移。** 现有代码两条取数路径读的都是订阅数：

- **主路径** GraphQL：`repo-info-query.ts:64` 查 `watchers { totalCount }`，
  `client.ts` 的 `extractRepoInfo` 取 `["watchers","totalCount"]` → `RepoInfo.watchersCount`
  → `repos.watchers_count`
- **降级路径** REST：`client.ts:280` 在 FORBIDDEN 回退时读 `subscribers_count` → 同一个字段

两条路径指向同一个量，历史数据是一致的。`recordCurrentPeriods`
（`stats.ts:464`）已经把它写进三张 stats 表的 `total_watchers` / `delta_watchers`，
**历史已经完整保存**。

**接口上的处理：**

- 仓库档案（§3.6）新增 `subscribersCount`，即当前的 `repos.watchers_count`，满足"只返当前的"。
- 统计接口（§4.1）的 `totalWatchers` / `deltaWatchers` **就是**订阅数的历史，不再另起字段名。
  理由：加一对 `totalSubscribers` / `deltaSubscribers` 作为同值的别名，等于让两套名字长期并存，
  半年后没人说得清哪个才是权威；把语义写清楚比复制一份字段可靠。
  若第三方接入方对 `watchers` 这个词有歧义担心（§2.9），在文档里给映射表，不在 payload 里给别名。

**`apps/web` 侧需要修的（不在本文范围内，但会因此踩坑）：**

| `repo_snapshots` 列 | 当前来源 | 实际语义 | 应改为 |
|---|---|---|---|
| `stars` | `data.stars` | 正确 | 不变 |
| `watchers` | `data.watchers_count`（REST 别名） | **实际是 star 数，与 `stars` 重复** | 删除或改为订阅数 |
| `subscribers` | 无 | 空 | 从 console 的 `totalWatchers` / `subscribersCount` 填 |
| `forks` / `openIssues` / `contributors` / `pullRequests` / `releases` / `commits` | 对应字段 | 正确 | 不变 |

`design-github-repos-skills-webhook-sync.md:76` 描述的映射（`watchers_count → watchers`）
就是这个错误的源头，它把 REST 的遗留别名当成了字面意思。

**取数成本：零额外请求。** `subscribers_count` 在 REST 的 `GET /repos/{owner}/{repo}` 响应里，
`watchers.totalCount` 在已有的 GraphQL 查询里，两者都已经在打，不需要新增 GitHub 调用。

**一个诚实的边界：** GitHub 的 watch（通知订阅）功能在 2020 年做过调整，
对很多仓库而言 `subscribers_count` 会等于收藏数或与之接近，数值本身的信息量有限。
它对 `apps/web` 的价值主要在于与 `stars` 的**比值**（关注度是否转化为订阅）。
如果实测下来发现绝大多数仓库两者相等，值得先看一眼真实分布再决定要不要在 web 侧建索引。

---

## 5. 排行与周期目录

### 5.1 排行

```
GET /api/v1/rankings/weekly?year=2026&week=14&limit=100
GET /api/v1/rankings/monthly?year=2026&month=3&limit=100
```

`year`/`week`/`month` 都不传时取 `lastCompletePeriod`
（`apps/console/src/lib/tasks/tasks/build-rankings.ts:149`）—— 与 dashboard、build 任务、
匿名 `/api/rankings/week.json` 三方一致。这一点 `apps/console/src/lib/rankings-web.ts` 的注释
已经论证过（"silently ranking a different week than was asked for"）。

实现上直接复用 `buildRankingsForWeek` / `buildRankingsForMonth`。它们是**重算而非读缓存**
（`rising-stars.json/route.ts` 的注释解释了为什么：匿名路由没有写权限，不能重算成写入），
所以开放 API 复用它们同样安全。

返回沿用 `Rankings`（`rankings.ts:62`）：`trending` + `byRelativeGrowth`，
`relativeGrowth: null` 保留（此前 star 数为 0 时比率未定义，发`Infinity` 会让所有新仓库霸榜）。

### 5.2 周期目录

「年度周排行列表 / 年度月排行列表」有两种可能的读法，接口用两条路由分别覆盖，不猜：

```
GET /api/v1/rankings/periods?year=2026&cadence=weekly
GET /api/v1/rankings/periods?cadence=monthly&limit=120
```

- 读法 A（某年有哪些期）→ `year=2026&cadence=weekly`，返回该年**有数据**的 ISO 周升序列表。
  复现 `listWeeklyPeriods`（`available-periods.ts:40`）+ 年份过滤。
- 读法 B（全部可用期）→ 不传 `year`，倒序返回（`DEFAULT_LIMIT = 120`）。

客户端因此可以先列目录、再逐期取排行，而不必猜哪些期存在。**目录只列有数据的期**——
列出一个没有行的周，等于把客户端送去拿一个必然是 404 的请求。

### 5.3 与 web 排行的边界

`CONSOLE_RADAR_COMMERCIAL_PLAN.md` §7.3 已决策：radar 的"信号排行"（按 star 净增/相对增长）
与 web 的"行为排行"（按用户实际使用）是两个东西，不合并。

因此本节的排行接口**只输出 radar 信号**，`scopes` 里没有能让它写web 的能力，
web 若要消费只能在自己的库里另存一份，不能覆盖 `rankings` 系列表。

---

## 6. 订阅机制

### 6.1 表结构

```sql
-- 0015_subscriptions.sql
CREATE TABLE "subscriptions" (
  "id"            text PRIMARY KEY,
  "name"          text NOT NULL,

  -- 归属主体：API key 或 console 账号，二选一。
  -- 订阅既可能是某个接入方的（M2M），也可能是某个 console 用户的（自助订阅自己的提交）。
  -- CHECK 保证恰好一个非空，否则投递时无从判断"这是谁的订阅"。
  "api_key_id"    text REFERENCES "api_keys"("id") ON DELETE CASCADE,
  "user_id"       text REFERENCES "user"("id") ON DELETE CASCADE,

  "callback_url"  text NOT NULL,
  -- 只存 sha256(明文)。secret 明文仅在 create/rotate 时返回一次。
  "secret_hash"   text NOT NULL,
  "secret_prefix" text NOT NULL,
  "cadence"       text NOT NULL DEFAULT 'daily',      -- daily | weekly | monthly
  "scopes"        text[] NOT NULL,

  -- 过滤条件。语义见 §6.6。
  "project_types"     text[] NOT NULL DEFAULT '{}',   -- 至少一项，见 §6.6 的 in() 约束
  "platform_types"    text[] NOT NULL DEFAULT '{}',
  "include_platform"  boolean NOT NULL DEFAULT true,
  "include_uncurated" boolean NOT NULL DEFAULT true,
  "include_own_submissions" boolean NOT NULL DEFAULT true,
  "repo_ids"      text[],                             -- NULL = 走上面的过滤器
  "mode"          text NOT NULL DEFAULT 'batch',      -- batch | snapshot

  "enabled"       boolean NOT NULL DEFAULT true,
  -- 已成功投递到的位置。只有投递成功才推进，失败不动，因此重试会重发同一批。
  "watermark"     timestamp with time zone,
  -- 连续失败计数，达到阈值触发熔断。
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "disabled_reason"     text,
  "last_delivered_at"   timestamp with time zone,
  "last_error"          text,
  "expires_at"          timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone
);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_one_owner_ck"
  CHECK (("api_key_id" IS NOT NULL) <> ("user_id" IS NOT NULL));
CREATE INDEX "subscriptions_key_idx" ON "subscriptions" ("api_key_id");
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" ("user_id");
CREATE INDEX "subscriptions_enabled_idx" ON "subscriptions" ("enabled") WHERE "enabled";

-- 0015 续：投递日志
CREATE TABLE "webhook_deliveries" (
  "id"              text PRIMARY KEY,
  "subscription_id" text NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  -- 幂等键：同一批的多次重试共用一个，重试时不变。
  "event_id"        text NOT NULL,
  "event"           text NOT NULL,
  "payload"         jsonb NOT NULL,          -- 存原文，重试时发同一份字节
  "watermark"       timestamp with time zone NOT NULL,
  "attempt"         integer NOT NULL DEFAULT 1,
  "status"          text NOT NULL,          -- pending | delivered | failed
  "http_status"     integer,
  "error"           text,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at"    timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" ("event_id");
CREATE INDEX "webhook_deliveries_retry_idx"
  ON "webhook_deliveries" ("next_attempt_at") WHERE "status" = 'pending';
CREATE INDEX "webhook_deliveries_sub_idx" ON "webhook_deliveries" ("subscription_id");
```

`webhook_deliveries.payload` 存**原文**而不是重新序列化：重试必须发同一份字节，
否则 `eventId` 相同而签名不同，接收方的重放窗口会拒掉（也正是签名要存在的原因）。

**过滤器不建成独立的 `subscription_filters` 表**，而是直接放在 `subscriptions` 上：
过滤条件永远是一对一跟着订阅走的，没有独立生命周期，也没有"多个订阅共享一个过滤器"的用法。
拆表只会多一次 join 和一个需要级联删除的东西。

**过滤器不入库为 JSON**，而是一组带类型的列。理由：`project_types` 要参与
`projects.type = ANY(...)` 的索引扫描，JSONB 里的数组做不到这一点——
过滤发生在每次推送时，不是一次性的。

### 6.2 创建订阅

```http
POST /api/v1/subscriptions
```

```jsonc
{
  "name": "web-marketplace",
  "callbackUrl": "https://web.example.com/api/hooks/console",
  "secret": "自行生成，至少 32 字节熵",     // 可选，不传则服务端生成并返回一次
  "cadence": "daily",
  "scopes": ["repos.stats", "repos.rankings", "repos.metadata", "repos.user_repos"],

  "filters": {
    // 显式白名单。给了就完全覆盖下面的类型过滤器 —— 优先级最高，也最容易解释。
    "repoIds": ["V1StGXR8Z5jd"],

    // 项目类型，至少一项。取值来自 projects.type。
    "projectTypes": ["skill", "persona"],

    // 是否纳入平台收录的项目（有 projects 行的仓库），以及它们的类型。
    "includePlatformProjects": true,
    "platformTypes": ["skill"],

    // 是否纳入"还没有 project 行"的候选仓库。
    "includeUncurated": false,

    // 是否纳入该主体自己的 user_repos（见 §6.3）。
    "includeOwnSubmissions": true
  },

  "mode": "batch",
  "expiresAt": "2027-01-01T00:00:00Z"      // 可选
}
```

过滤器的完整语义（每一条的判定规则、默认值、互斥关系）在 §6.6。

订阅级 `scopes` 与 key 的 `scopes` 是**两个不同的东西**，职责不同：

- key 的 `scopes` 管"能不能创建/管理订阅"。
- 订阅的 `scopes` 管"这个订阅推哪些内容"。

服务端在投递时用订阅自己的 `scopes` 读库，**不借用调用方 key 的权限**。
这样一条只有 `subscriptions:write` 的 key 也能订阅 `repos.stats`，
而 key 被降权或吊销时，订阅要么一起被删（级联），要么按订阅自身的 scope 继续——行为可预测。

响应里 `secret` 仅此一次：

```jsonc
{
  "id": "sub_abc123",
  "name": "web-marketplace",
  "callbackUrl": "https://web.example.com/api/hooks/console",
  "secretPrefix": "kPq3",         // 仅用于之后人工比对
  "secret": "kPq3_…",            // ← 只此一次，之后任何接口都不再返回
  "cadence": "daily", "mode": "batch",
  "scopes": ["repos.stats", "repos.rankings", "repos.metadata"],
  "enabled": true, "watermark": null
}
```

### 6.3 触发时机

订阅推送**严格挂在 `build-rankings` 成功之后**。这是需求的核心约束：
"console 拉完全部排行数据之后，再把更新的数据推给订阅者"。
若在 `update-github-data` 之后就推，接收方拿到的排行会缺尚未闭合的周期。

```
/api/cron/github  (0 18 * * * UTC)
  └─ update-github-data   fetchRepos + upsertRepo + recordCurrentPeriods（写日/周/月当期）
  └─ snapshot-stars       stargazers/history 补写已闭合周期
  └─ build-rankings       落 weekly / monthly 排行
  └─ notify-subscriptions   ← 新增任务，投递订阅
```

`notify-subscriptions` 作为**独立任务**而不是 build-rankings 尾部的一行调用：
任务框架已经有 `taskDefinitions` / `taskExecutions` 的调度、重入保护
（`task.alreadyRunning`）和历史，混进 build-rankings 会让"排行失败"和"推送失败"共用一条
执行记录，运维看不出是哪一环坏了。它需要 `build-rankings` 刚成功这一前置条件，
所以在 registry 里声明为依赖 `build-rankings` 顺序执行。

### 6.4 增量与水位线

`mode: "batch"`（默认）：

1. 读订阅的 `watermark`（首次为 null → 取"所有已存周期的起点"，即给订阅建立时的全量）。
2. `resolveSubscriptionRepos(db, subscription)` 算出本订阅命中的仓库集合（§6.6）。
3. `listStatsSince(db, cadence, watermark, repoIds)` 取该之后的所有变更行。
4. 组装 payload，`payload.watermark` = 本批覆盖到的最大 `period`。
5. **写一条 `webhook_deliveries`（`status: pending`）**，然后才发。
6. 发成功 → 该 delivery 置 `delivered`，`subscriptions.watermark` 推进到本批 watermark。
7. 发失败 → `attempt + 1`，按退避重排`next_attempt_at`；**watermark 不动**。

因此失败重试会重发同一批（同一 `eventId`、同一 payload 字节），不会跳过数据，
也不会重复计入已投递的部分 —— 因为 watermark 只在成功时前进。

**过滤器变更时 watermark 怎么办**：不重置。
水位线表示"这个订阅的数据读到哪了"，而过滤器决定"读哪些"。改了过滤器之后，
新的命中集合里可能有从未推送过的仓库，但它们的 `period` 早于 watermark，
按 `period > watermark` 取就取不到。

处理方式：过滤器变更后，把 watermark **回退**到"新命中集合的最早已存周期"，
让新纳入的仓库至少推一次完整的现有历史，而不是静默地永远收不到。
代价是已推送过的数据可能重复一次——消费方按 `eventId` 去重挡不住这种（`eventId` 不同）。
因此 payload 里带 `filtersVersion`，消费方可以据此判断是"新数据"还是"过滤器变更后的补发"。

这个取舍写在文档里，是因为它是一个真实的语义选择：
要么漏推，要么可能重推。选"可能重推"，因为漏推是静默的，重推是可见的。

退避：`1s → 5s → 30s → 5min → 30min`，最多 8 次，之后 `status: "failed"`，
但 **watermark 依然不动**：下一轮 cron 会重新生成一批新的 delivery（新的 `eventId`），
消费方靠 `eventId` 去重即可，而漏掉的数据会在下一批补上。

熔断：`consecutive_failures >= 20` → `enabled = false`，
`disabled_reason = "too_many_failures"`，队列保留。
消费方修好后 `PATCH /api/v1/subscriptions/{id}` 恢复。
不做的事：永不熔断。永远失败的订阅如果一直重试，会把 cron 的时间预算吃光，
连带影响其他订阅。

`mode: "snapshot"`：每次推该订阅范围内**全部**最新一期，不带 watermark，不做增量。
给"只要当前状态"、自己管存储的消费方。

### 6.5 payload

```jsonc
{
  "eventId": "evt_batch_20260401",
  "event": "data.daily.updated",
  "deliveredAt": "2026-04-01T18:12:44.902Z",
  "watermark": "2026-04-01T16:00:00Z",
  "timezone": "Asia/Shanghai",
  "cadence": "daily",
  // 过滤器每次变更 +1。消费方据此区分"新数据"与"过滤器变更后的补发"（§6.4）。
  "filtersVersion": 3,
  "counts": { "repos": 128, "periods": 128 },
  "repos": [
    {
      "repoId": "V1StGXR8Z5jd",
      "fullName": "owner/name",

      // 订阅主体的关系信息。仅当 scopes 含 repos.user_repos 时输出。
      // 只包含该主体自己的行；别人的提交关系永远不出现在任何 payload 里。
      "userRepo": {
        "source": "api",
        "status": "active",
        "pinned": true,
        "note": "重点跟踪",
        "submittedAt": "2026-01-05T02:11:00Z",
        "platformStatus": "curated",
        "platformSyncedAt": "2026-04-01T18:00:00Z"
      },

      // 过滤器命中时推送这个仓库的原因。消费方可以用它调试"为什么我订的没推"。
      "matchedBy": ["projectType", "platformType", "ownSubmission"],

      "classification": {
        "projectTypes": ["skill"],       // 该仓库所有 project 的 type（可能多个）
        "isPlatformProject": true,
        "platformStatus": "curated",
        "tags": ["mcp", "agent"]
      },

      "daily":   { /* §4.1 单期 */ },
      "weekly":  { /* 最近一期，仅当 scopes 含 repos.stats */ },
      "monthly": { /* 最近一期，仅当 scopes 含 repos.stats */ },
      "rankings": {
        "weekly":  { "period": {"year": 2026, "week": 14}, "trending": [...], "byRelativeGrowth": [...] },
        "monthly": { "period": {"year": 2026, "month": 3},  "trending": [...], "byRelativeGrowth": [...] }
      }
    }
  ]
}
```

`userRepo.note` 是**私有列**（`USER_REPO_PRIVATE_COLUMNS`，`apps/console/src/db/schema.ts`），
只有行主人能读。一个 M2M key 订阅返回的是"这个 key 自己提交的仓库"的 note，
不会泄露任何 console 用户的私有备注 —— 因为投递时按 `subscription.api_key_id` /
`subscription.user_id` 精确匹配 `userRepos`，不带"该仓库的全部提交者"。

请求头与 §3.5 完全一致（`X-Webhook-Id` / `X-Webhook-Timestamp` / `X-Webhook-Signature` /
`X-Webhook-Event`），验签流程也一致。**一套签名格式覆盖回调和订阅**，否则消费方要实现两套。

- `eventId` 在 batch 模式下由 `subscriptionId + watermark` 派生（同一水位线的重试必然相同），
  snapshot 模式下由 `subscriptionId + 日期` 派生。
- 单个 payload 上限 2MB / 1000 个仓库。超限时拆多个 delivery，**按 `repoId` 字典序切分**，
  顺序投递，且只有最后一个 delivery 成功后才推进 watermark。

### 6.6 过滤器语义

这是本文最容易实现错的一节，因为"平台项目""项目类型""自己的提交"三个集合互相重叠。
先定义三个数据来源：

| 来源 | 判定 | 基数 |
|---|---|---|
| **项目类型** | `EXISTS (SELECT 1 FROM projects p WHERE p.repo_id = r.id AND p.type = ANY($types))` | 一个仓库可有**多个** project 行，因此可有多个 type |
| **平台项目** | 该仓库有 `projects` 行，且未被标记 `projects.status = 'hidden'` | 同上 |
| **自己的提交** | `EXISTS (SELECT 1 FROM user_repos u WHERE u.repo_id = r.id AND u.(user_id\|key_submitter) = $owner)` | 恰好 0 或 1 行 |

过滤规则，按**求值顺序**（先命中即短路，语义上等价于 OR）：

| # | 条件 | 结果 |
|---|---|---|
| 1 | `repoIds` 非空 | **完全绕过下面所有规则**。只推名单内的仓库 |
| 2 | 自己的提交且 `includeOwnSubmissions = true` | 命中，`matchedBy` 含 `ownSubmission` |
| 3 | 是平台项目 且 `includePlatformProjects = true` 且（`platformTypes` 为空 或 type 命中） | 命中，`matchedBy` 含 `platformType` |
| 4 | 有 project 行 且 `projectTypes` 非空 且 type 命中 | 命中，`matchedBy` 含 `projectType` |
| 5 | **无** project 行 且 `includeUncurated = true` | 命中，`matchedBy` 含 `uncurated` |
| 6 | 其他 | **不推** |

三个必须写进文档和代码注释的陷阱：

**陷阱一：`projectTypes` 一旦非空，所有没有 project 行的仓库会被静默排除。**
这几乎肯定不是订阅者的本意——他要"skill 项目"，而一个刚被 API 创建、还没来得及策展的
skill 仓库正是他最想看的。`includeUncurated` 的默认值因此按条件推导：

```
includeUncurated 的默认值 = (projectTypes 为空 AND platformTypes 为空)
```

即"没按类型过滤时，全部都要（含未策展）；按类型过滤时，默认只要已策展的"，
订阅者想要更宽的范围得显式写 `"includeUncurated": true`。默认值写进 §6.2 的响应里回显，
不让它成为隐式行为。

**陷阱二：`platformTypes` 和 `projectTypes` 都读 `projects.type`，语义上会重叠。**
目前只有一套项目类型分类，所以两个字段是同一份数据的两个入口。这是有意为之——
分成 `radarType` 和 `platformType` 两套枚举，只会让运营在填表时面对一个说不清的问题。
若将来 radar 引入自己的分类（分类器打标是 `tags` 上已经在做的事），那时再拆；
现在拆等于提前为不存在的问题付复杂度。

两个字段都存在的原因是**开关不同**：`includePlatformProjects` 决定"策展动作是否影响我的订阅"，
`projectTypes` 决定"哪些类型进我的订阅"。合并成一个字段就没法表达
"我只想要 skill 类型的，但策展成 person 的也别推"这种组合。

**陷阱三：`projects.status = 'hidden'` 的项目算不算平台项目。**
不算 —— 与公开页面一致（`lib/public/radar.ts` 的 `PUBLIC_WHERE` 排除 hidden）。
被运营隐藏的项目推给外部，等于绕过 `/console` 的可见性判断把它泄露出去。

### 6.7 订阅归属与可见性

订阅有两个归属主体，由 §6.1 的 CHECK 约束二选一：

| 主体 | 创建入口 | 可见性 |
|---|---|---|
| API key | `POST /api/v1/subscriptions` | `GET /api/v1/subscriptions` 只返回 `api_key_id = 当前 key` |
| console 用户 | `/dashboard/subscriptions`（tRPC `subscriptionsRouter`，`protectedProcedure`） | 只返回 `user_id = 当前会话用户` |

**这是租户隔离的全部实现** —— 没有别的过滤条件。投递任务遍历所有
`enabled = true` 的订阅，按各自的归属主体算自己的过滤器，不存在"管理员看全部订阅"的接口
（admin 视角另走 `/dashboard/subscriptions` 的 admin 视图，只读，不带任何操作按钮）。

两套入口共用 `createSubscription` / `updateSubscription` / `deleteSubscription`
三个服务函数，服务层接受 `{ apiKeyId } | { userId }` 的判别联合。
不共用 HTTP 层：API key 走 Bearer，console 用户走会话 cookie，
把两者混在一个 handler 里会让鉴权分支出现在每一行。

用户订阅 `includeOwnSubmissions = true`（默认）时，
推送的每条记录带自己的 `userRepo` —— 这就是需求里"每个用户都有自己的 user-repo，
订阅之后 user-repo 会返回"。

### 6.8 投递失败对订阅方可见

`GET /api/v1/subscriptions/{id}` 返回 `lastDeliveredAt`、`lastError`、
`consecutiveFailures`、`enabled`、`disabledReason`，以及最近 20 条
`webhook_deliveries` 的 `{eventId, status, attempt, httpStatus, error, createdAt}`。

不给这个，订阅方唯一的排障手段是"等明天看数据有没有更新"。

`POST /api/v1/subscriptions/{id}/test` 发一条 `subscription.test` 事件的探测 payload
（内容极小、含一份真实的当前快照），**不推进 watermark**，让订阅方能在改过滤器时立刻验证回调地址。
鉴权与签名路径和正常投递完全一致——如果测试事件能验签通过，正常事件也能。

---

## 7. 鉴权总表

| 方向 | 机制 | 实现 |
|---|---|---|
| 客户端 → console（读/写 API） | `Authorization: Bearer mcp_radar_<prefix>_<secret>`，查 `sha256` | §2.6新增 `lib/api/guard.ts` |
| console → 客户端（回调/订阅） | `X-Webhook-Signature` HMAC-SHA256 over `<ts>.<raw body>` + 300s 时间窗 | 复用 `lib/webhook/client.ts` |
| 接收方去重 | `X-Webhook-Id` 落幂等表 | 消费方责任 |
| console 内部（签发 key） | better-auth 会话 + `adminProcedure` | 现有 tRPC |

未配置任何凭据时，`/api/v1/*` 全部返回 **404**，与 `/api/internal/repos` 一致。

### 7.1 `GET /api/v1/openapi.json`

`apps/console` 已引入 `better-auth` 并启用 `openAPI()` 插件（`lib/auth.ts:130`），
本API 的 spec 另出一份，聚合 zod schema 生成，避免两处手写漂移。
`/api/v1/openapi.json` 本身需要有效 key（防止被当作免费的接口发现服务），
但返回的 spec 里不含任何实例专属信息。

---

## 8. `apps/web` 覆盖情况

| web 的需求 | 覆盖 | 说明 |
|---|---|---|
| 提交 URL 触发拉取 | ✅ §3 | 替代 `apps/web/src/lib/github-nextjs/client.ts` 里失效的 `${GITHUB_NEXTJS_API_BASE_URL}/api/internal/repos/fetch`（路径与 payload 都不匹配） |
| `checkGithub` / `connectFromGithub` / `pollSync` | ✅ §3.5 + §6 | 现在轮询自己的 `repos` 行；改回调或订阅后可由推送驱动，**轮询可以去掉** |
| `repos` 表同步 | ⚠️ 需 web 侧新增接收端 | `POST /api/webhook/daily` 至今不存在，`packages/db/src/mcp-schema.ts` 里的 `repos` / `repo_snapshots` 没有写入方 |
| `repo_snapshots.subscribers` | ✅ §4.4 | console 侧**已经在存**（`total_watchers` / `delta_watchers`），无需迁移。web 侧改映射即可 |
| `repo_snapshots.watchers` | ⚠️ 需要 web 侧修正 | 当前存的是 REST `watchers_count`，实际是 star 数，与 `stars` 列重复 |
| 按项目类型 / 平台项目订阅 | ✅ §6.6 | `projectTypes`、`platformTypes`、`includePlatformProjects` |
| 周/月排行驱动 UI | ⚠️ 有意隔离 | radar 排行不进 web workflow rankings（§5.3） |
| 发布门控 / 扫描 | ❌ 有意不做 | console 只给证据，发布是 web 的职责（`SKILLS_PUBLISH_POLICY.md`） |
| stargazer 明细 | ❌ 有意排除 | GitHub 对非管理员 403，覆盖不完整，不对外 |

---

## 9. 定位契合

`CONSOLE_RADAR_COMMERCIAL_PLAN.md` 把 console 定义为**雷达与决策引擎**，不是市场。
本文的接口恰好都是"读证据 + 推证据"，没有一个是"卖东西"或"管账号"：

- API Key 签发留在 console 的账号体系内（admin 权限），不与 web 打通 —— 符合 §7 的账号独立约束。
- 仓库创建只写 `repos` + `userRepos(source: "api")`，**不动 `repos.created_by`** ——
  radar 记录"这个仓库存在并被跟踪"，不主张"这个仓库属于谁"。
- 订阅是**读**推送，console 不要求接入方把数据写回来。
- 排行是信号，不覆盖 web 的行为排行。
- 不提供发布能力，不做扫描门控。

过滤器里的 `includePlatformProjects` 需要额外小心：它让 console 的策展动作
（"把这个仓库收录成一个项目"）直接影响外部订阅者的数据流。
这正是 radar 想要的——**策展是雷达的核心动作，它应该有对外可见的后果**——
但也意味着 `/dashboard/projects` 的编辑权限等于对外的数据分发权限。
这不是缺陷，是要记住的耦合。

一句话：console 通过这套 API 成为 web 和第三方的**上游数据源**，而不是它们的一个页面。

---

## 10. 实施顺序

按"无副作用先行"排列，每步可独立验证：

| 步骤 | 内容 | 迁移 | 风险 |
|---|---|---|---|
| 0 | `lib/redis/client.ts`（双驱动）+ `sliding-window.lua` + 分布式锁 | — | 低。纯基础设施，可先合 |
| 1 | `listStatsRange` + zod DTO + `GET /api/v1/repos/{id}/stats` | — | 低。纯读，需要步骤 2 的 guard |
| 2 | `api_keys` 表 + `adminProcedure` 签发/吊销/轮换 + `lib/api/guard.ts` + Redis 限流 | `0015` | 中。触及全部 `/api/v1` 的入口 |
| 3 | `POST /api/v1/repos` + 幂等表 + 首次拉取回调 | `0016` | 中。写路径，需保证不改 `createdBy` |
| 4 | 排行与周期目录路由 | — | 低 |
| 5 | `resolveSubscriptionRepos` + `GET /api/v1/repos` 的过滤器参数 | — | 中。过滤器语义是本文最容易实现错的部分 |
| 6 | `subscriptions` / `webhook_deliveries` 表 + `notify-subscriptions` 任务 + 重试/熔断 | `0017` | 高。任务编排、分布式锁、重试、熔断 |
| 7 | `/dashboard/subscriptions` 自助订阅页（tRPC） | — | 中。前端 |

> 迁移编号从 `0015` 起：`0014` 已被 `0014_restore_snapshots_table.sql` 占用
> （把 `snapshots` 表留在库里，见该文件的注释）。

步骤 1–5 都是同步无副作用的，可以先上线给 `apps/web` 联调；
步骤 6 是唯一有状态的部分，放在最后。

第 0 步提前的理由：步骤 2 的限流直接依赖它，而限流是所有 `/api/v1` 入口的必经之路。

## 11. 待确认

**已由本轮确认并写死的（不再列为问题）**

- `repo_snapshots.subscribers` → console 侧的 `total_watchers` / `repos.watchers_count`，无需迁移（§4.4）。
- 限流载体 → 本地 Redis + Vercel Upstash，双驱动同一 `RedisLike` 接口（§2.8）。
- `mode: "snapshot"` → 保留，为第三方接入（§2.9）。
- 订阅支持项目类型多选、平台项目开关、平台项目类型、自己的 user-repo（§6.2、§6.6、§6.7）。

**仍需拍板的**

1. **第三方 key 的签发路径**。当前设计是 admin 签发（`adminProcedure`）。
   第三方接入意味着"接入方自助注册 → 拿到 key"，这需要：注册入口、滥用防护
   （IP 限流 / 邮箱验证 / 人工审核）、初始 scope 与配额的默认值、以及一个"申请中"状态。
   这是本文**唯一一块尚未展开**的设计。是否现在补，还是先按 admin 签发跑通、
   等到真有第二个接入方再设计？（倾向后者：自助签发的需求细节取决于接入方是谁，
   现在猜大概率猜错。）

2. **`includeOwnSubmissions` 对 M2M key 的含义**。key 可以带 `submitterId`
   （§2.2），此时"自己的提交"= 该 `submitterId` 名下的 `userRepos`。
   但一个接入方通常提交了几百上千个仓库，都记在一个 `submitterId` 名下——
   这条订阅就会**几乎不过滤**，退化成"推全部"。
   是否给 `api_keys` 加一个"订阅不隐含 user_repo 关系"的默认？倾向默认 `false`
   （M2M 订阅默认不含 `includeOwnSubmissions`），因为 M2M 通常只想按类型订阅全量。

3. **`platformTypes` 与 `projectTypes` 的重叠是长期状态还是过渡状态**。
   当前设计让两者读同一份 `projects.type`，并在 §6.6 陷阱二里写明"将来拆"。
   如果 radar 的自动分类器（`tags.confidence`，见 `apps/console/src/db/schema/github.ts`）
   已经在规划一套独立的项目分类，那现在就该拆成两个枚举。

4. **web 侧 `repo_snapshots.watchers` 列怎么处理**。§4.4 指出它当前存的是 star 数。
   是删列、还是保留并在写入时改成订阅数？删列需要 web 侧迁移，保留则名字继续骗人。

5. **`subscribers_count` 的实际信息量**。GitHub 在 2020 年调整过 watch 功能，
   很多仓库的 `subscribers_count` 可能与 `stargazers_count` 相等。
   建议在实现前先跑一次真实分布统计（`repos` 里两列的比例分布），
   再决定 web 侧要不要为它建列——如果 90% 的仓库两者相等，这一列的价值有限。
   console 侧无论如何都已经在存，不受影响。