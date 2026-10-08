# 国内 VPC × Vercel Hobby：GitHub 出口经 Vercel 代理 + Sandbox 扫描编排

> 状态：方案稿（2026-10-07）
> 约束来源：应用必须部署在国内 VPC；不建专线、不走代理、成本最低优先；合规（GitHub 数据/凭据不经境内出口）。
> 相关：[SKILL_SECURITY_SCAN_PIPELINE.md](./SKILL_SECURITY_SCAN_PIPELINE.md)（sandbox 取源、`isVercelRuntime`、mode 语义不变）、[CONSOLE_RADAR_COMMERCIAL_PLAN.md](./CONSOLE_RADAR_COMMERCIAL_PLAN.md)、[CONSOLE_OPEN_RADAR_API.md](./CONSOLE_OPEN_RADAR_API.md)

---

## 0. 这次要解决什么

`apps/console` 有两类出站到境外 GitHub 的流量，国内 VPC 直连二者都不可行，而专线/代理两条路都被排除：

| 类别 | 出站目标 | 现有实现 | 出口方案 |
|---|---|---|---|
| GitHub 数据同步（REST + GraphQL） | `api.github.com` | `src/lib/github/client.ts` 硬编码两处常量，`fetch` 直连 | **Vercel 上的转发 Route A** |
| Skill 安全扫描取源 | `github.com` git clone，在 sandbox 里跑规则 | `src/lib/skill-scan/*`，`isVercelRuntime()` 判定 | **Vercel 上的编排 Route B** |
| README 内图片 / 头像 | `raw.githubusercontent.com`、`avatars.githubusercontent.com` | `process-readme-{md,html}.ts` 解析出 URL | **边界项**，见 §6 |
| 定时任务唤醒 | Vercel Cron | `vercel.json` `0 18 * * *` + `/api/cron/github` | **console 进程内置 cron**（`instrumentation` 启动即调度，时间不变，§5）；云定时触发器作为备选 |

核心思路一句话：**让"访问 GitHub"这个动作整体发生在 Vercel 云端**（它在美国、天然可达 `api.github.com` / `github.com`），国内 VPC 对 GitHub 的直连为零，只通过 HTTPS 访问 Vercel 上自己控制的代理项目。

---

## 1. 架构总览

```
国内 VPC（apps/console 全量部署：自有 DB、Redis、任务、API）
│
│  HTTPS（仅发往 Vercel 代理项目，无 proxy/专线）
├─→ Vercel 代理项目（一个 Hobby 项目）
│     ├── /api/github/rest/*     →  https://api.github.com/*        （Route A，REST 转发）
│     ├── /api/github/graphql    →  https://api.github.com/graphql  （Route A，GraphQL 转发）
│     └── /api/scan              →  @vercel/sandbox · OIDC 自动认证  （Route B，扫描编排）
│
├─ 国内出站：CONSOLE_DATABASE_URL（境内 DB）、REDIS_URL（自托管 ioredis）、
│            腾讯云 SMS、阿里云 OSS、SMTP（nodemailer）、DeepSeek/OpenAI API
│
└─ 内置 cron（instrumentation 启动即调度）：`0 18 * * *` UTC 直接调 runScheduledTasks
```

**关键性质：国内 VPC 对 GitHub 域名的出站为零。** 一切 `api.github.com` / `github.com` 访问都在 Vercel 侧完成；国内侧新增的唯一凭据是"调用代理项目的 secret"，GitHub 凭据不再进境内。

---

## 2. 决策记录：为什么两个能力都在 Vercel 上

### 2.1 为什么 GitHub 转发放 Vercel 而不是国内直连

国内 VPC 直连 `api.github.com` 不稳定且受限，无代理、无专线条件下没有可用出口。Vercel Function 位于美国，天然直连 GitHub，且 Hobby 免费。这是"不建专线、不走代理"约束下的唯一可选出口。

### 2.2 为什么 sandbox 由 Vercel 侧编排，而不由国内应用直调（回答"本地调还是 Vercel 调"）

结论：**由 Vercel 编排（Route B 在代理项目内）**。理由：

1. **OIDC 认证只在 Vercel 环境注入。** `@vercel/sandbox` 推荐生产用 `VERCEL_OIDC_TOKEN`（Vercel 自动管理过期）。国内 VPC 拿不到 OIDC，只能放一枚长期 `VERCEL_TOKEN` + `VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID`——token 落境内有泄漏面，还要自己轮换、重新下发。Route B 在 Vercel 上跑，OIDC 零配置。
2. **沙箱配额与"谁调用"无关。** Hobby 的 Sandbox 免费额度（Active CPU 5 h/月、5000 次创建/月、Data Transfer 20 GB/月，见 §8）挂在 Vercel 账户上，无论从国内还是从 Vercel 函数发起创建，消耗的都是同一份。既然消耗相同，就把"编排逻辑"放最长寿、最靠近沙箱 API 的地方。
3. **网络最短。** Vercel 函数到沙箱创建走 Vercel 内部网络；国内直调 `vercel.com/api` 多一跳公网，延迟与失败面更大。
4. **`isVercelRuntime()` 语义对齐。** `src/lib/skill-scan/index.ts` 里 `isVercelRuntime()` 为真才走 sandbox 分支；Route B 在 Vercel 运行时天然为真，无需在国内进程里伪造 `VERCEL=1`。国内应用永远走"转发到 Route B"的形态，绝不落到 `local-clone` 的 git clone（那会直连 `github.com`）。
5. **时限够用。** Hobby Function 最大 300 s（§8），sandbox 默认 120 s 超时 + 60 s 命令，留足余量；现有 `scan/route.ts` 注释本来就把 300 s 当作编排预算。

### 2.3 为什么代理项目是无状态的

Route A/B 只做转发和扫描执行，不读写任何企业库——这样它可以在 Hobby 上以最小依赖部署（不需要 DB/Redis），也没有境内数据出境的问题。国内 `apps/console` 保留全部鉴权（`skills:scan` API key）、限流、落库职责。

---

## 3. Route A：GitHub REST / GraphQL 转发

### 3.1 端点契约

| 国内 console 调用 | 代理项目端点 | 上游 |
|---|---|---|
| `GET/PUT/POST/PATCH/DELETE` 任意 REST | `/api/github/rest/*`（`*` 即 GitHub path，query 原样带） | `https://api.github.com/<path>?<query>` |
| `POST` GraphQL | `/api/github/graphql` | `https://api.github.com/graphql`（JSON body 原样） |

**必须按原文回传的**：HTTP status、`x-ratelimit-*` 头、响应体。因为 `client.ts` 的 `trackRateLimit()`（限流告警）与 `toGitHubError()`（按 status/headers 归类 403/404/transport）依赖它们，代理剥掉任一项都会让 console 的降级/告警逻辑失真。

建议实现：代理项目里两个 route handler，`fetch` 到上游后 `new Response(body, { status, headers: {...保留 x-ratelimit-*、content-type} })`，不要整包转发（去掉无关服务头）。

### 3.2 GitHub 凭据放哪（合规决策）

**推荐：`GITHUB_ACCESS_TOKEN` 只配在 Vercel 代理项目，不进国内。**

- 凭据不出境：境内 VPC 只持有一个调用代理的 secret（`EGRESS_SECRET`），不持有任何 GitHub 凭据，合规审查面最小。
- 代理校验请求头（如 `X-Egress-Secret`），命中才注入 `authorization: token <GITHUB_ACCESS_TOKEN>` 转发；否则 401。
- 国内 console 的 `GITHUB_ACCESS_TOKEN` 配置即可移除。

> 备选（改动更小但凭据会流经 Vercel）：国内保留 token，console 原样携带 `authorization`，代理透传。优点是 console 代码只改 URL 常量；缺点是 GitHub 凭据在每次请求里经过代理项目，不合"凭据不出境"。仅在"必须最小改动"时选它。

### 3.3 console 侧改动点

- `src/lib/github/client.ts:26-27`：两处硬编码常量改为读 env，缺省仍是 `https://api.github.com`（本地/测试不变，改了一种形态什么都不动）：
  - `GITHUB_API_BASE_URL` → REST 根（代理的 `/api/github/rest`）
  - `GITHUB_GRAPHQL_URL` → GraphQL 端点（代理的 `/api/github/graphql`）
- `src/lib/github/client.ts:197` / `:239`：`authorization` 头的组装从"GitHub token"改为"代理 secret"（`EGRESS_SECRET`），或进入依赖项经 `src/request.ts` 统一注入。粒度上不要每个调用点各改一遍。
- `src/lib/github/client.ts` GraphQL 分支用的仍是裸 `fetch`，代理兼容即可，不需要回退 `graphql-request`。

---

## 4. Route B：Sandbox 安全扫描编排

### 4.1 契约

| | |
|---|---|
| 端点 | `POST /api/scan`（代理项目内） |
| 请求 | `{ repoFullName, ref?, skillDir?, includeLlm? }` —— 与现有 `skillScanRequestSchema` 同源 |
| 鉴权 | `X-Egress-Secret`（与 Route A 同一 secret） |
| 响应 | `SkillScanReport`（`source: vercel-sandbox` / `vercel-sandbox-serverless`），不返回全文除非 `includeLlm` |
| `maxDuration` | `300`（Hobby 上限，sandbox 120 s + 命令 60 s 留余量） |

### 4.2 实现

复用 `@workspace/security-scan`（规则 + `buildSandboxScanScript` + `analyzeWithLlm`）+ `@vercel/sandbox`。逻辑即 `apps/console/src/lib/skill-scan/sandbox.ts` 的 Vercel 分支（`Sandbox.create({ source: { type: "git" } })` → `runCommand("node", script)` → `parseSandboxScanOutput`），落在代理项目路由里。代理项目 `next.config` 需要 `transpilePackages: ["@workspace/security-scan"]`（与 console 相同）。

实现取舍（沿用 `SKILL_SECURITY_SCAN_PIPELINE.md` §3.4）：
- 缺省 `sandbox` mode（规则在 VM 内跑，源码不出 VM，`includeLlm` 时才把内容带回函数喂复核器）。
- in-sandbox 失败自动回落 `serverless` mode。
- `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 配在代理项目 env；DeepSeek `api.deepseek.com` 海外可达（全球节点），由 Vercel 侧直接调（§6.2 若不可达则另行处理）。

### 4.3 国内 console 侧改动点

`src/app/api/v1/skills/scan/route.ts` 保留**鉴权、限流、响应契约不变**，只把取源/执行改为转发到 Route B：

```
POST /api/v1/skills/scan  （国内）
  ├─ authenticateApiKey(scope "skills:scan")
  ├─ 校验 skillScanRequestSchema
  └─ POST https://<proxy>/api/scan，头带 X-Egress-Secret
       └─ 成功 → 原样封装 SkillScanReport
       └─ 失败 → 502 source_unavailable / scan_failed（语义与现状一致）
```

本地开发（无代理配置）时回落现有 `local-clone` 逻辑；生产（`EGRESS_BASE_URL` 已配）走转发。两者的分界用 env 判定，不按调用点判断。

---

## 5. 定时任务（cron）替代

- `vercel.json` 里的 `crons`（`0 18 * * *` → `/api/cron/github`）是 **Vercel 平台能力**，console 不再部署在 Vercel 后它不生效。
- 默认替代：**console 进程内置 cron，启动即调度，运行时间不变**。`src/instrumentation.ts`（Next 16 instrumentation，`register()` 钩子）在满足三条件时启动 `src/lib/tasks/in-process-cron.ts`：
  - `NEXT_RUNTIME === "nodejs"`、`NODE_ENV === "production"`、`IN_PROCESS_CRON_ENABLED !== "false"`。`next build` 也会加载 instrumentation，第三个开关专门防止构建进程里起 timer。
  - 调度器用 `nextDueInstant(VERCEL_CRON_SCHEDULE, now, { timeZone: "UTC" })` 选下一个 `0 18 * * *` 时点，到点调 `runScheduledTasks(due)` 后递归重排；`MAX_TIMEOUT_MS = 2^31 - 1` 下自动分段，幂等防双实例、`running` 防重叠（多实例安全仍由 runner 的 per-task DB 锁兜底）。
  - 无 secret（`CRON_SECRET` 未配）时 `/api/cron/github` 保持 `fail closed`（404），内置 cron 不依赖该端点——它直接调用 `runScheduledTasks`，`Authorization` 校验只保护"外部触发器"这一可选路径。
- 备选（供无多进程管理、需外部可见唤醒的部署）：境内云定时触发器（阿里云 OOS 定时、或云主机 crontab + `curl`），在 `18:00 UTC`（北京 02:00）以 `Authorization: Bearer $CRON_SECRET` 调国内 console 的 `/api/cron/github`。此时可设 `IN_PROCESS_CRON_ENABLED=false`，两者取其一。
- `/api/cron/github` 仍与"谁唤醒"解耦：`src/lib/tasks/` 的种子顺序、DB 锁都不受影响，外部触发器与内置 cron 共用同一 `runScheduledTasks` 入口。

---

## 6. 周边出口核查

| 出站 | 现状 | 处置 |
|---|---|---|
| DB / Redis / SMS / OSS / SMTP | 境内 | 不动。Redis 用自托管 `REDIS_URL`（ioredis），**不配** `KV_REST_API_URL`（Upstash 在境外） |
| DeepSeek / OpenAI（翻译 + LLM 复核） | 当前配在 console env | 翻译线：境内直连 DeepSeek（国内 API），保留在 console；扫描复核：`DEEPSEEK_API_KEY` 放代理项目（§4.2） |
| README 图片 `raw.githubusercontent.com` / `avatars.githubusercontent.com` | `process-readme-md.ts:201` 对解析出的 URL 做 `HEAD` | **边界项**：若国内需要真正拉取这些图（图标落 OSS 场景），在代理项目加 `/api/github/raw/*` 转发（同 Route A 机制）；若仅需 URL 元数据（头像嵌推送封面），可不转发，确认无境外抓取 |
| `api.github.com` 之外的 `fetch`（`process-readme-md.ts:201` 等） | 少数几个 | 逐一审计，凡目标是 GitHub 域全部收口到 Route A 或移作边界项 |

---

## 7. 凭据与合规边界

| 凭据 | 放哪 | 说明 |
|---|---|---|
| GitHub token | **只存在于 Vercel 代理项目 env** | 境内零 GitHub 凭据 |
| `EGRESS_SECRET` | 国内 console + 代理项目各一份 | 调用 Route A/B 的共享 secret，境内 Vercel 双持有（本就同一控制方） |
| `CRON_SECRET` | 国内 console | 已有，语义不变 |
| `VERCEL_OIDC_TOKEN` | 不配置 | Vercel 自动注入到 Route B 运行时 |
| `DEEPSEEK_API_KEY` 等扫描复核 key | 代理项目 env | 不进 sandbox（§4.2），只留在函数环境 |

**合规自检清单**（部署后核对）：
1. 国内 VPC 没有通往 `github.com` 的域名解析/出站 → `egress` 全在 Vercel。
2. GitHub 凭据未进入境内任何 env/token 存储。
3. 若代理项目 DNS/证书被篡改，`EGRESS_SECRET` 会暴露 → 上线后轮换一次，并设低权限最小 token 范围（只读 repo 元数据即可，无需写）。

---

## 8. Vercel Hobby 免费额度核算（2026-09 官方）

| 资源 | Hobby 免费量 | 本方案的用量 |
|---|---|---|
| Sandbox Active CPU | 5 h/月 | 每扫描 1 个 sandbox（git clone 是 I/O 等待，**不**计 active CPU；规则跑若干秒）；月度扫描量几十～几百次量级远在 5 h 内 |
| Sandbox Provisioned Memory | 420 GB-h/月 | 1 vCPU / 默认内存的短暂生命周期，可忽略 |
| Sandbox Creations | 5 000 次/月 | 超出的概率低；超出后**暂停创建到下个周期，不产生账单** |
| Sandbox Data Transfer | 20 GB/月 | includeLlm 时内容回传计入；非 LLM 扫描只回 manifest，几十 KB/次 |
| 并发 Sandbox | 10 | 扫描是低频按需，不会并行打满 |
| 单次 session | ≤45 min | sandbox 120 s 超时远未触及 |
| Function max duration | 300 s（默认即上限） | Route B 设 `export const maxDuration = 300`，现有设计本就按 300 s 预算 |
| Function Invocations | 1 000 000/月 | 代理转发（REST/GraphQL 每请求 1 次）+ 扫描 = 远小于此 |

结论：**Hobby 免费额度内完全可行**，且超限即停、不产生账单，天然对齐"成本最低优先"。唯一要盯的是 Sandbox Data Transfer（LLM 复核会拉文件内容），有 20 GB/月护栏；如超用可把扫描默认关掉 `includeLlm` 或把内容大小上限调小。

---

## 9. Vercel 部署步骤（代理项目）

### 9.0 前置

- 一个 Vercel 账号（Hobby，免费）。
- 一个独立的 monorepo 子目录承载代理项目（即 `apps/vercel-egress/`，**非 Next.js**，纯 Hono + Vercel Functions）：
  - `api/[[...route]].ts` — 一个 catch-all Vercel Function，`export const config = { runtime: "nodejs", maxDuration: 300 }`，内部做 `app.fetch(req)`（`src/app.ts` 的 Hono 应用，路由见 §3/§4）。不进 `app/` 目录、不用 `hono/vercel` 已被废弃的适配器。
  - `src/lib/github-forward.ts`（Route A · REST/GraphQL 转发 + 多 token 轮换）
  - `src/routes/scan.ts`（Route B · 入口）+ `src/lib/skill-scan/*`（编排）
  - 依赖：`@vercel/sandbox`、`@workspace/security-scan`（monorepo workspace 依赖）、`hono`。

### 9.1 操作

1. **本地验证**：`pnpm -w` 根跑 `pnpm lint` / `pnpm typecheck`；再进 `apps/vercel-egress` 跑 `pnpm bundle:check`——它把 `api/[[...route]].ts` 用 esbuild 打成一个文件并断言 `@workspace/security-scan` 被内联（`typecheck` 跑的是原始 TS，验证不了部署时 pnpm/Vercel 的解析链路）。
2. **推送到 Git 远端**（Vercel Import 依赖 GitHub 认证）。
3. Vercel Dashboard → **Add New → Project** → 选择本仓库。
4. **Root Directory** 指向 `apps/vercel-egress`。Framework Preset 无需选 Next.js——本目录没有 `next.config`，Vercel 会把它当作 Node.js Functions 目录；`api/` 里已带 `config`（runtime nodejs / maxDuration 300），无需在 dashboard 另设函数时长上限。
5. 项目模式默认 **Hobby**。不要启用任何付费附加项。
6. **Environment Variables**（Project → Settings → Environment Variables）添加：
   - `GITHUB_ACCESS_TOKEN`（或 `GITHUB_TOKENS` 逗号分隔列表）——GitHub 只读 PAT
   - `EGRESS_SECRET`（与国内 console 一致的共享 secret，**至少 32 字符**）
   - `EGRESS_FORWARD_TIMEOUT_MS` / `EGRESS_MAX_REQUEST_BODY_BYTES` 可选（转发超时与请求体上限，默认 30s / 1 MiB）
   - `DEEPSEEK_API_KEY`（扫描复核需要时才配）
   - `SKILL_SCAN_SANDBOX_VCPUS` 等 sandbox 预算参数可选（§4.1）
   - （`VERCEL_OIDC_TOKEN` 不必配，Vercel 运行时自动注入）
   - （Proxy 无 DB/Redis，**不配**任何 Upstash / `KV_REST_*` / 数据库变量，保持无状态）
7. **Deploy**。得到域名 `https://<project>-*.vercel.app`。生产域名从 Settings → Domains 固定（或不绑定，直接用生成的 production 域名）。
8. **冒烟验证**（注意：路由用 `X-Egress-Secret`，**不**带 GitHub `Authorization`——token 在代理侧注入）：
   ```
   # health（Vercel 只把 /api/* 路由进函数，健康检查在 /api/healthz）
   curl -s https://<proxy>/api/healthz
   # REST 转发（token 由代理注入）
   curl -s https://<proxy>/api/github/rest/rate_limit \
        -H "X-Egress-Secret: $EGRESS_SECRET"
   # GraphQL 转发
   curl -s -X POST https://<proxy>/api/github/graphql \
        -H "X-Egress-Secret: $EGRESS_SECRET" \
        -H "content-type: application/json" \
        -d '{"query":"{ viewer { login } }"}'
   ```
   确认 status 与 `x-ratelimit-remaining` 行为与直连一致；不带 secret 的请求应 401，未配置 token 时应 503。

### 9.2 国内 console 侧切换（改完 deploy）

1. `.env` 增加并设值：
   - `GITHUB_API_BASE_URL=https://<proxy>/api/github/rest`
   - `GITHUB_GRAPHQL_URL=https://<proxy>/api/github/graphql`
   - `EGRESS_BASE_URL=https://<proxy>`（Route B 基地址）
   - `EGRESS_SECRET=<共享 secret>`
   - 移除 `GITHUB_ACCESS_TOKEN`（境内不再持有）
2. 生产环境移除任何指向 GitHub 的出口白名单/防火墙例外——**不应存在**，否则等于没切换。
3. 跑一轮同步：进程内置 cron 会在 `18:00 UTC`（北京 02:00）自动触发 `runScheduledTasks`，观察同步任务经由代理完成；`POST /api/v1/skills/scan` 观察 `source: vercel-sandbox`。

### 9.3 定时器

- **默认：console 进程内置 cron，启动即自动调度，无需任何外部定时器**（§5）。确认 `IN_PROCESS_CRON_ENABLED` 未设或非 `false` 即可，运行时间仍为 `18:00 UTC`（北京 02:00）。
- 需要外部可见唤醒时才配云定时器（并用 `IN_PROCESS_CRON_ENABLED=false` 关闭内置）：
  - 阿里云 OOS 创建定时任务（Cron `0 2 * * *`，北京时区即 18:00 UTC）：HTTP 请求 `GET/POST https://<console-domain>/api/cron/github`，携带 `Authorization: Bearer $CRON_SECRET`。
  - 或云主机 `crontab`：`0 2 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<console-domain>/api/cron/github >/dev/null 2>&1`。

---

## 10. 已知边界与风险

1. **`egress` 是新的单点。** 代理项目不可达时，GitHub 同步与扫描全部失效；console 自身（DB/UI/API key）不受影响。风险提示需要写进 console 的告警（`GITHUB_DATA_WEBHOOK_URL` 类外部探活可选）。
2. **README 图片/头像若需实际抓取**是额外的 raw 转发（§6），不在三件事的主干里，别被它带偏了上线的范围。
3. **DeepSeek 从 Vercel 可达性未实测。** 若 `api.deepseek.com` 对美区不可达，扫描复核阶段需换 `OPENAI_API_KEY` 或把"复核"委派回国内 console（但那样内容要回国，Vercel 侧不保留——见 §4.1）。上线前用一条真实扫描验证 `includeLlm` 路径。
4. **凭据被代理项目看得到的边界**：`EGRESS_SECRET` 每请求携带。选择 HTTPS 传输；若合规审计要求更严，可改为每次请求短期签名（HMAC 同 `GITHUB_DATA_WEBHOOK_SECRET` 机制），列为后续增强，不阻塞本期。
5. **Hobby 无 SLA。** 免费档没有支持与冗余承诺，符合"成本最低"的前提；若后续需要稳定性，升级 Pro 只是加钱不是改架构，本方案不预设付费。

---

## 11. 验收清单

- [ ] 国内 VPC 对 `github.com` / `api.github.com` 出站为零（抓包/防火墙日志核对）。
- [ ] REST 转发：`rate_limit`、`repos/{owner}/{repo}`、stargazers 分页结果与直连一致，`x-ratelimit-remaining` 正确。
- [ ] GraphQL 转发：批量 `repoInfo` 查询、读 star history 与直连一致。
- [ ] 扫描：`POST /api/v1/skills/scan` 返回 `source: vercel-sandbox`，`includeLlm` 时 LLM 阶段完成；sandbox 失败回落 `serverless` 时不降级评级。
- [ ] 定时任务经 **console 进程内置 cron** 在 `18:00 UTC` 自动跑完一轮（种子顺序、DB 锁语义不变）；`IN_PROCESS_CRON_ENABLED=false` 时可切回外部触发器。
- [ ] Redis 为自托管 `REDIS_URL`，无 `KV_REST_API_URL` / Upstash 残留。
- [ ] `GITHUB_ACCESS_TOKEN` 已从国内环境移除。