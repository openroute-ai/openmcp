# Skill 安全扫描流水线（独立模块 × 按部署环境分类执行）

> 状态：实现对齐稿（2026-10-06）
> 取代：`apps/web/src/lib/security-scan/run-scan.ts` 里「编排 + 取源」混在一起的形态
> 相关：[SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md)（门控语义不变）、[ADMIN_REVIEW_QUEUE_UED.md](./ADMIN_REVIEW_QUEUE_UED.md)、[CONSOLE_OPEN_RADAR_API.md](./CONSOLE_OPEN_RADAR_API.md)、[design-github-repos-skills-webhook-sync.md](./design-github-repos-skills-webhook-sync.md)

---

## 0. 这次要解决什么

导入一个 GitHub 技能时，**安全扫描此前没有真正接入**：`apps/web` 只能扫到 `skill.yaml` 与
两份 README（`filesFromSkillRow` 的全部能力），入口脚本、配置、源码都不在扫描范围内，而
UI 文案写的是「全部文件」。仓库的真实源码只有 `apps/console` 拿得到（它才有 GitHub 凭据）。

于是职责重新划分：

| 关注点 | 归属 | 理由 |
|---|---|---|
| 扫描规则、评级、LLM 语义复核 | **`packages/security-scan`**（独立模块，零 IO） | 三处调用方（web 本地 / console 本地 / console sandbox）必须跑**同一份**规则，否则同一个仓库在两个环境得出两个评级 |
| **取源码**（clone / sandbox） | **`apps/console`** | 它才有 GitHub 凭据，且它已经有仓库同步域 |
| **落库与门控** | 仍是 `apps/web`（`skills` / `skill_scans` / `skill_reviews` 在它的库里） | 表在这里，console 不写共享库（见 `apps/console/next.config.mjs` 的说明） |
| **入口** | `apps/console` 的 `POST /api/v1/skills/scan` | 机器对机器，`skills:scan` scope，不开放自助签发 |

`apps/web` 在 GitHub 导入路径上改为**调用 console 扫**，自己只负责把结果写进自己的表；
ZIP 上传路径文件本来就在本地，仍然全程本地扫（见 §6.3）。

---

## 1. 流水线

```
             ┌──────────────────────── packages/security-scan ────────────────────────┐
             │  file-picker → match-file（36 条规则）→ gradeFromFlags → （可选）LLM 复核 │
             └──────────────────────────────────────────────────────────────────────────┘
                                        ▲                          ▲
              files + context ─────────┘                          │
                                                                │
  ┌───────────────────── apps/console · lib/skill-scan ─────┴─────────────────────────┐
  │  isVercelRuntime() ?                                                              │
  │    是 → sandbox.ts（Sandbox.create({ source: { type: "git" } })）                  │
  │           mode = SKILL_SCAN_VERCEL_MODE                                             │
  │             ├─ "sandbox"（默认）在 VM 内跑规则 ─→ 只回 flags/grade（includeLlm 时   │
  │             │                                    连内容一起回，交给函数里的复核器） │
  │             └─ "serverless"    读文件回函数 ────→ match-file + LLM 复核             │
  │    否 → local.ts（git clone --depth=1 到 SKILL_SCAN_TMP_DIR）→ match-file + 复核    │
  └────────────────────────────────────────────────────────────────────────────────────┘
                                        │ SkillScanReport（纯 JSON，可跨进程）
                                        ▼
                    POST /api/v1/skills/scan  →  apps/web 落库 + 门控
```

**关键性质：扫描结果与「文件从哪来」无关。** 三个取源适配器都产出同一个
`SkillSourceSnapshot`，之后走同一条纯函数流水线，所以 Vercel 与自建部署对同一个
`owner/repo@sha` 一定给出同一个 `securityGrade`。

---

## 2. 独立模块 `packages/security-scan`

源码直出（`exports` 指向 `./src/*.ts`），与 `packages/storage`、`mail` 一致，**不引入构建步骤**。
因此两个 app 都必须把它列进 `transpilePackages`。

### 2.1 目录与职责

| 文件 | 职责 | Node-only |
|---|---|---|
| `types.ts` | `SecurityGrade` / `SecurityFlagHit` / `ScanResult` / `ScanContext` 等 | 否 |
| `patterns.ts` | 36 条规则的**纯数据**表（唯一真相来源） | 否 |
| `match-file.ts` | 单文件的匹配与抑制；`computeTrustTier`；`gradeFromFlags` | 否 |
| `rule-scanner.ts` | 文件遍历 + 去重 → `RuleScanResult` | 否 |
| `file-picker.ts` | **取源侧共用的文件筛选规则**（扩展名白名单 / 排除目录 / 二进制判定 / 体积上限） | 否（`Uint8Array`） |
| `scan-skill.ts` | 两阶段编排：`runRuleScan` / `runFullScan` / `runSkillScan`，含 `mergeGrades` | 仅经 `llm-analyzer` |
| `llm-analyzer.ts` | 阶段 2：LLM 语义复核（无 key 静默降级为 `null`） | 是（`process.env`） |
| `gateway-scan.ts` | MCP / A2A **元数据**扫描（另一条流水线，规则版本独立） | 否 |
| `sources.ts` | 跨取源适配器的类型：`SkillSourceFile` / `SkillSourceSnapshot` / `SkillScanReport` | 否 |
| `sandbox-script.ts` | 生成可注入 sandbox 的自包含扫描脚本（§4.3） | 否 |

### 2.2 导出面

- `.` — 全部（含 `analyzeWithLlm`，Node-only）
- `./core` — 规则与网关扫描，**不拖 `ai` / `@ai-sdk/openai`**，供任何浏览器侧引用

### 2.3 依赖版本

包内 `ai` / `@ai-sdk/openai` / `zod` 与两个 app 对齐（`ai@^7`、`@ai-sdk/openai@^4.0.80`、
`zod@^4`）。此前包内是 `ai@4` + `@ai-sdk/openai@4`，两者分属 `LanguageModelV1` 与 `V4` 两个
provider spec，靠一句 `as any` 掩盖：`maxTokens` 被静默丢弃、`usage.promptTokens` 读到
`undefined`。对齐后那句逃逸可以删掉。

---

## 3. `apps/console`：取源与分类

### 3.1 环境判定

`lib/skill-scan/env.ts`：

- `isVercelRuntime()` — `process.env.VERCEL === "1"` 或存在 `VERCEL_ENV`。**只看这个**，
  不用 `VERCEL_URL`（预览分支上它也可能有值，而本地 `vercel dev` 同样会设 `VERCEL`——
  这正是我们要走 sandbox 的形态）。
- `vercelScanMode()` — `SKILL_SCAN_VERCEL_MODE`，取值 `sandbox` | `serverless`，
  缺省 `sandbox`，非法值不回落到缺省而是落到 `serverless` 并打一条警告：`serverless`
  是不执行生成脚本的那个模式，一个拼错的 env 该赔吞吐量，不该赔正确性。

判定结果是**部署期**的事，不是请求期，所以每次调用现读 env 即可，不需要缓存或注入。

### 3.2 非 Vercel：本地 clone

`lib/skill-scan/local.ts`（`cloneAndCollect`）

1. `git clone --depth=1 --no-checkout --single-branch <owner>/<repo>.git <tmp>`
2. `git -C <tmp> checkout <ref>`；`ref` 缺失或已不存在时**回落默认分支**——调用方在问一个
   已经搬走的仓库，答「checkout 不出来」不如答关于 `main` 的结论。
3. 按 `file-picker` 的规则遍历、读文本
4. `skillDir` 做包含性校验（`resolveBase`，resolve 后比较），越界抛
   `InvalidSkillDirError` → 400
5. checkout 目录放在 `SKILL_SCAN_TMP_DIR`（缺省 `/tmp/skills-scan`）。**每次请求自删**
   （`finally` 里）：单个 checkout 是一次性的，没有下游要读它；只有进程在 clone 与该
    `finally` 之间死掉才会留下目录，那是 `cleanup-skill-scan-tmp` 兜底任务（每日删
    24h 前的目录）的分内事，不是常规路径。

私有仓库走匿名 clone 会 401，`git clone` 的 stderr 直接透出给调用方；私有技能的扫描入口是
ZIP 上传，不是这个端点。

### 3.3 Vercel：Sandbox

`lib/skill-scan/sandbox.ts`（`scanRepository`）

```ts
const sandbox = await Sandbox.create({
  source: { type: "git", url: `https://github.com/${repoFullName}.git`, depth: 1, revision: ref },
  timeout: sandboxTimeoutMs(),          // 缺省 120 000 ms
  resources: { vcpus: sandboxVcpus() }, // 缺省 1
})
```

**用 `source.type: "git"` 而不是自己在 sandbox 里 `git clone`**：clone 由 Vercel 的镜像
服务完成，不占 sandbox 的启动预算，也就不受 `maxDuration` 与 git 网络抖动影响；仓库根本
不需要被检出到函数能执行命令的程度。sandbox 用完即删（`stop()` + `delete()`），不留快照。
`networkPolicy` 由 SDK 缺省管理（drop-in：只有 GitHub 域可达）；`timeout` 是兜底而非
清理策略，请求函数还要通过 `signal` 在自身超时前先停掉 sandbox。

### 3.4 两个执行位置的取舍（本次的核心问题）

需求里给了两条路：**在 sandbox 里扫** vs **把文件读出来在 serverless 里扫**。两条都实现了，
由 `SKILL_SCAN_VERCEL_MODE` 切换，缺省 `sandbox`。记号：脚本里的文件内容开关
`includeContent` 由 `includeLlm` 打开——**复核器永远在函数里跑**，sandbox 里没有模型 key。

| | `sandbox`（缺省） | `serverless` |
|---|---|---|
| 规则跑在哪 | VM 内一次 `node` 调用 | 函数内（文件经 sandbox 的 fs 读回） |
| 文件内容是否离开 VM | 仅当 `includeLlm`（阶段 2 要内容）；否则只回传 manifest `{path, size}` | 是。阶段 2 在函数里跑，必然要内容 |
| 函数耗时 | 1 次 VM 启动 + 1 次命令调用 | 1 次 VM 启动 + 逐文件读回 |
| 与本地路径同源 | 是。脚本由**本包的规则对象**生成（§4.3） | 是。同一份 `match-file` 匹配器 |
| 失败面 | 脚本生成/执行失败 → 自动回落 `serverless` | 文件读取失败 → 扫描不完整 |
| 额外依赖 | 需要生成脚本（§4.3），是唯一的新复杂度 | 无 |
| 密钥 | **不需要**把 `DEEPSEEK_API_KEY` 注入 sandbox | 阶段 2 在函数里跑，密钥不出函数 |

选 `sandbox` 为缺省的理由，按权重排：

1. **耗时与文件数解耦。** 200 个文件的 `serverless` 模式要在函数预算里逐个读回，
   这与 `maxDuration` 直接冲突；`sandbox` 模式无论多少文件都是一次命令。
2. **不可信内容不进我们的进程（除非复核要）。** 扫描器永远不执行被扫的代码（只有正则）；
   默认下 200 个攻击者控制的文件只以 `{path, size}` 的 manifest 过网，`includeLlm` 时才
   把内容搬进函数喂给复核器，而那次搬运的字节数仍受 `limits.maxTotalBytes` 约束。
3. **LLM 阶段留在函数里。** 阶段 2 需要密钥，`sandbox` 模式下密钥**永远不进 sandbox**。

选它的代价是 §4.3 那段脚本生成，所以它必须有兜底：生成或执行失败（`InSandboxScriptError`）
时**自动回落 `serverless`**，并在响应里把 `source` 标成实际用的那个。**只有这一种失败会
回落**：仓库取不到、sandbox 创建失败、`skillDir` 越界，在读回路径上同样会失败，重跑是浪费。
这是整个设计里唯一一处「两套实现」，因此 §4.3 的等价性由单测钉死。

### 3.5 响应里的 `source` 字段

`SkillScanReport.source` 取值 `local-clone` | `vercel-sandbox` | `vercel-sandbox-serverless`。
它回答的是「文件从哪来」，不是「评级可不可信」——`rulesVersion` 才是后者的答案。
把它写进响应而不是只打日志，是因为「同一个仓库两次扫描结论不同」是排障的第一个问题，
而它几乎总是这两个字段之一变了。

---

## 4. 边界的三个细节

### 4.1 文件筛选只有一份

扩展名白名单、排除目录、二进制判定、体积上限都在 `file-picker.ts`。此前 sandbox 路径与
本地路径各写一份，且两份**行为不一致**（sandbox 那份的扩展名过滤是个空分支、
隐藏文件不跳过）——同一个仓库在两个环境会得到不同的文件集合，于是不同的评级。
现在两边都调 `file-picker`，这种漂移不再可能。

上限沿用：200 文件 / 10 MiB 总量 / 1 MiB 单文件。命中任一上限时 `truncated: true` 且带
`truncatedReason`，**不静默**——被截断的扫描结论只能算部分结论。

### 4.2 `unknown` 不参与门控

未取到任何可扫文件时 `grade` 是 `unknown`（不是 `safe`）。`unknown` 不在
`SKILLS_AUTO_PUBLISH_GRADES` 里，因此按 `SKILLS_PUBLISH_POLICY.md` §4.1 落到
`pending_review`。理由：拿不到文件就说「通过」，等于给「扫描失败」发了一张通行证。

### 4.3 sandbox 脚本怎么生成（唯一一处字符串拼装）

需求要求规则只有一份，所以脚本不能手抄。`packages/security-scan/src/sandbox-script.ts`
的 `buildSandboxScanScript()` 是从**活模块**拼出来的：

- **规则表与上限以 JSON 序列化。** 36 条 `PatternDef` 的正则用 `{ source, flags }` 两半
  出行（`RegExp` 不是 JSON），再在脚本里 `new RegExp(def.source, def.flags)` 还原；
  `FENCE_RE` / `NEGATION_RE` / `PLACEHOLDER_SECRET_RE`、白名单、tier 名单、`limits` 一并
  序列化进 `TABLES`。一个字都没有第二份。
- **匹配器、可信分层与评级**来自 `match-file.ts` / `file-picker.ts` 的函数
  `Function.prototype.toString()`（`BORROWED_SOURCES`，刻意穷尽 `matchPattern` 可达的
  全部辅助函数）。编译产物是合法 JavaScript，sandbox 跑的就是本进程本来会跑的那份代码。
- **驱动（遍历 / 读文件 / 打印标记行）** 是内嵌字符串 `DRIVER`：它做 IO，而这个包不做 IO，
  借不来也不该借。

脚本写成无依赖、仅 CommonJS 前提的 `.js`→`.cjs` 单文件（sandbox 镜像里只有 Node），整个
调用就是 `node <file>`；以 `SANDBOX_SCAN_MARKER`（`__OPENMCP_SCAN__`）开头的一行 + 尾随
JSON 是 `parseSandboxScanOutput()` 的唯一解析契约。文件内容开关 `includeContent` 由调用方
按 `includeLlm` 决定（阶段 2 在函数里跑），所以脚本里还保留 `SCAN_FILE_MAX_SIZE` 上限与
本地一致。

兜底：脚本跑不起来或输出不可解析（`InSandboxScriptError`）时，console 自动回落
`serverless` 模式。一个坏掉的序列化不该让整个扫描功能不可用——**降级是更慢，不是不扫**。

---

## 5. `POST /api/v1/skills/scan`

| | |
|---|---|
| scope | `skills:scan`（仅 admin 签发，不在 `SELF_SERVICE_SCOPES`） |
| 请求 | `{ repoFullName, ref?, skillDir?, includeLlm? }`，`.strict()` |
| 响应 | `SkillScanReport` + `{ context, files: [{path, size}] }`（`source` 回传实际执行位置；**不回传全文**——阶段 2 要内容时 console 在函数内部消化掉） |
| 幂等 | 不做。同一输入的结论是确定的，重放没有价值，而幂等槽要占一次写 |
| `maxDuration` | 300s |

请求**不传 `context`**。console 只会从 `repoFullName` 拆出 `owner` 补进 trust 上下文——它没有
parse GitHub API 拿 stars / license / homepage 的路径，也不该有：那个调用方真想用其余字段
影响 `trustTier`（从而影响 `high` 命中的评级），在本端点没有旋钮。web 的本地（补偿 / ZIP）
路径才传那份完整 `context`，而它本来就是 web 自己从本地 `repos` 行拿的。

---

## 6. `apps/web` 的接入

### 6.1 客户端

`lib/console/client.ts` 增加 `scanSkillOnConsole()`，走与 `submitRepo` 同一套 Bearer +
超时基建（`INGEST_TIMEOUT_MS` = 180s，与 ingest 同量级：都要 clone）。console 没配
（`consoleApiConfigured()` 为假）时**不调用**，直接回落本地扫描。

### 6.2 落库

`lib/security-scan/run-scan.ts` 拆成两层：

- `persistSkillScanResult(skillId, result)` — 写 `skills` / `skill_scans` /
  `skill_reviews`、通知 admin、触发 eval report。**纯落库，不含扫描。**
- `runSkillSecurityScan(...)` — 本地扫描 + `persist`（ZIP、rescan 兜底）
- `runRemoteSkillSecurityScan(...)` — 调 console 拿 `ScanResult` + `persist`

拆分的理由：两条路径的**结论来源**不同（本地算的 / console 算的），但**门控语义必须完全
一致**。门控逻辑写在两处的话，「ZIP 导入 caution 自动上架、GitHub 导入 caution 进人工」
这种偏差会一直在，直到有人发现。

### 6.3 各路径

| 路径 | 文件来源 | 扫描位置 |
|---|---|---|
| GitHub 导入（`connectFromGithub`） | console | console（`sandbox` / `serverless` / `local-clone`） |
| GitHub 重扫（`rescan`） | console | console |
| ZIP 上传（`connectFromParsed`） | 本地解压 | web 本地 |
| console webhook 入库（`ingest-console-skill`） | 推送的 `metadata.sourceFiles` | web 本地（补偿扫描，仓库全文留给 console 端点） |
| admin 重扫 | 同上 | web 本地 |

`rescan` 改为走 console 之后，请求不再带任何 trust 上下文——console 自己从
`repoFullName` 补 `owner`，`context` 字段在远端端点里不存在。`connectFromParsed` 的
`context: {}` 保留——ZIP 里没有这些信息，`computeTrustTier` 落到最严的 tier 5，这是对的。

### 6.4 失败语义

console 扫描失败**不**把技能判死：技能行留在 `status: "scanning"` +
`securityGrade: "unknown"`，错误进日志。理由与 `SKILLS_PUBLISH_POLICY.md` §3 一致——
未完成扫描不可上架，但也**不该**因为扫描器抖了一下就把用户的提交变成 `rejected`。

---

## 7. 配置

| 变量 | 位置 | 缺省 | 说明 |
|---|---|---|---|
| `SKILL_SCAN_VERCEL_MODE` | console | `sandbox` | `sandbox` \| `serverless`，非法值 → `serverless` |
| `SKILL_SCAN_TMP_DIR` | console | `/tmp/skills-scan` | 本地 clone 的根目录 |
| `SKILL_SCAN_TMP_MAX_AGE_HOURS` | console | `24` | 兜底任务清理多少小时前的目录 |
| `SKILL_SCAN_MAX_FILES` | console | `200` | 参与扫描的文件数上限 |
| `SKILL_SCAN_MAX_TOTAL_BYTES` | console | `10485760` | 参与扫描的总体积上限 |
| `SKILL_SCAN_MAX_FILE_BYTES` | console | `1048576` | 单文件上限 |
| `SKILL_SCAN_SANDBOX_TIMEOUT_MS` | console | `120000` | sandbox 存活时长（不覆盖函数自己的 300s `maxDuration`） |
| `SKILL_SCAN_COMMAND_TIMEOUT_MS` | console | `60000` | sandbox 内 `node <script>` 的调用上限 |
| `SKILL_SCAN_SANDBOX_VCPUS` | console | `1` | 每次扫描的 vCPU（IO + 几遍正则，无可并行的东西） |
| `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` | console + web | — | 阶段 2；都没有则跳过复核（`LLM_UNAVAILABLE`） |
| `SKILLS_AUTO_PUBLISH_GRADES` | **web** | `safe` | 门控，见上架策略 §4 |
| `SCAN_FILE_MAX_SIZE` | web / script | `5242880` | 本地补偿路径的单文件读入上限；脚本内同名常量 |

Vercel 上还有 SDK 自己的凭据：`VERCEL_OIDC_TOKEN`（推荐）或
`VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` + `VERCEL_TOKEN`。缺任一项时 `Sandbox.create`
整体不可用，`scanRepository` 抛 `SkillSourceUnavailableError`（→ 502 `source_unavailable`），
而**不**静默回落本地 clone——serverless 函数里没有 `git`，那里的「本地」路径根本跑不起来。

---

## 8. 已知边界

1. **`function.toString()` 依赖编译产物形态。** §4.3 的兜底把「不可用」降级成
   「慢一点」而不是「扫不了」，但它确实是这个方案里唯一脆弱的接缝：`BORROWED_SOURCES`
   遗漏一个可达名字在本地只是少扫一种场景、在 sandbox 里是 `ReferenceError`——因此
   `sandbox-script.test.ts` 里那条「sandbox 与本地同输入同结论」的不变式同时覆盖了
   「名单漏人」这一类错误。等价的做法是给这个包加一个真实的 bundle 步骤，把扫描器打成
   单文件再注入——代价是给它接上构建链。
2. **私有仓库不支持。** 三条路径都走匿名或无凭据的 clone。私有技能走 ZIP。
3. **sandbox 是有成本的外部资源。** 每个 GitHub 导入都会开一台 MicroVM。这是缺省选
   `sandbox` 而不是 `serverless` 时要付的钱，写在这里以免下一个人以为它免费。
4. **规则表本身没有测试覆盖**（`rule-scanner` 此前零测试）。这次补的
   `sandbox-script.test.ts` 会顺带覆盖「sandbox 模式与本地模式同输入同结论」这条不变式，
   但 36 条规则各自的语义仍然需要有人逐条确认。