# OpenMCP 雷达 — `apps/console` 商业方案（v1）

> **文档类型**：商业 / 产品 / 协同方案（v1，只写文档，不改任何应用代码）
> **撰写日期**：2026-09-30（Asia/Shanghai）
> **受众**：管理层、产品、工程、增长、商务
> **代码基线**：`apps/console` @ `ea4e2da` · `apps/web` @ `15d2270`（**已含 v0 工程任务 E1 的未提交 WIP：`page.tsx` 迁移 TanStack Router + `components/landing/*`**）
> **姊妹文档**：[OPENMCP_COMMERCIAL_PLAN.md](./OPENMCP_COMMERCIAL_PLAN.md)（平台/网关商业闭环）· [OPENMCP_PRODUCT_PLAN.md](./OPENMCP_PRODUCT_PLAN.md) · [OPENMCP_EVAL_V1.md](./OPENMCP_EVAL_V1.md) · [SKILLS_PUBLISH_POLICY.md](./SKILLS_PUBLISH_POLICY.md) · [design-github-repos-skills-webhook-sync.md](./design-github-repos-skills-webhook-sync.md)
> **约束**：本方案不改动 web / api 的现有商业决策；品牌沿用 [OPENMCP_COMMERCIAL_PLAN.md](./OPENMCP_COMMERCIAL_PLAN.md) 决策 #11（终端用户只见 OpenMCP 与 OpenWork）。
> **代码现状声明**：本文标注了每一处「已实现 / 已设计未实现 / 待新建」，避免把设计稿当成既有能力。

---

## 1. 摘要与决策锁定

### 1.1 一句话定位

**OpenMCP 雷达是面向企业技术决策者的开源选型决策引擎；OpenMCP 市场（`apps/web`）保持「注册 + 网关 + 交易」。前者是漏斗顶部，后者是收银台。**

雷达的核心资产不是 star 数，而是 **stargazer 到达时间戳**（`snapshot-stars.ts` 遍历每个 stargazer 的时间戳，写入 `repo_weekly_stars`）。这让雷达拥有竞品结构性无法获得的能力：**判断一个项目正在变好还是变坏，包括下行信号。**

### 1.2 已锁定决策

> 以下 15 项由产品所有者于 2026-09-30 拍板，作为本文的**约束前提**，后续章节均以此为准。其中 #1–#10 为首批，#11–#15 为代码更新后追加（触发点见 §12.1）。

| # | 决策 | 结论 |
|---|---|---|
| 1 | 品牌与域名 | **OpenMCP 雷达**，主域 **`radar.openmcp.cn`**（详见 §1.3.1） |
| 2 | 部署与域名 | **独立部署、独立域名**。**已锁定 `radar.openmcp.cn`**（§1.3.1）。~~vercelai.cn~~ **不采用**（商标混淆 + 语义不符，理由见 §1.3.1） |
| 3 | 与 web 的账号 | **各自独立**。不共享 `user` 表、不共用会话。代价与补偿见 §7.1 |
| 4 | 是否收费 | **个人永久免费**；**唯一收入来源是组织级「监控 + 协作」订阅**（Pro ¥99/月、Team ¥999/月起） |
| 5 | 是否卖信息 | **不卖**。排行榜、异动、尽调全部免费公开（SEO 与获客）；**取消按次计费** |
| 6 | 是否复用 `openmcp-eval-v1` | **不复用、不重定义**。web 管商品内质量，雷达管生态外部信号（§2.2） |
| 7 | 是否合并 DB | **不合并**。`CONSOLE_DATABASE_URL` 与 `DATABASE_URL` 各自独立。**两侧交互一律且仅经 HTTP API**，无跨库读写、无共享表 |
| 8 | 数据采集归属 | GitHub 采集**只在 console 做一次**，web 经 API 接收，不重复采（省 API 预算，见 §7.3） |
| 9 | 自有评分体系 | **不引入 0-100 综合分**（理由见 §4.3） |
| 10 | 雷达榜 vs web 榜 | **完全分离，互不引用**。两套排名各自定义语义，不合并、不互相取数（§7.4） |
| 11 | 技术栈 | **Next.js App Router + shadcn 原生 `table`**。**禁止引入第三方路由**（TanStack Router / React Router 等）（§5.6） |
| 12 | 是否复用 web 的 catalog / Store MCP | **不复用、不重复造**。web 的 `catalog.search` / `recommend_assets` / Store MCP 归 web 所有，雷达自建自己的检索能力（§7.6） |
| 13 | web 的 `tags` 数据 | **不回写雷达**。雷达需**自建对应表/字段**承载能力标签，便于后续使用（§5.7） |
| 14 | 落地页 | **已按 §5.8 + §5.9 重构完毕**：六维评分 92 → 生命体征 + 异动旗标，公开公式文案已删，定价改 `¥0/¥99/¥999/定制`，删除「每日 3 次 AI」，首屏改为实时异动 feed（§5.8、§5.9.4） |
| 15 | 与 web 的视觉关系 | **分层一致，不是完全统一**。L1 信任层共用（字体/圆角/组件结构/暗色/i18n），L2 定位层分离（主色/密度/首屏/语气/签名组件）。涨跌用**红涨绿跌**，风险不靠颜色（§5.9） |

### 1.3 品牌与命名

#### 1.3.1 定名与域名

| | 说明 |
|---|---|
| **品牌** | **OpenMCP 雷达**（英文 Radar） |
| **一句话** | **别人告诉你这个项目多受欢迎，我们告诉你它正在变好还是变坏。** |
| **中文 tagline** | 找到值得引入的开源项目，并看住它。 |
| **主域** | **`radar.openmcp.cn`**（已锁定） |
| **API** | `api.radar.openmcp.cn`（或 `/api/*` 同域，视部署拓扑定） |
| **文档** | `radar.openmcp.cn/docs` |
| **徽章** | `![Radar Signal](https://radar.openmcp.cn/badge/{owner}/{repo}.svg)`（供 README 反向引用，形成外链与自然流量） |

**关于域名的取舍（已知并接受）**

`radar` 是通用词，无法单独注册商标、无法完全防守独立品牌。**这是明确接受的代价**：本产品的品牌价值不由域名承载，而由「异动数据 + 社区实测」这两项他人无法快速复制的资产承载（§2.3）。`radar.openmcp.cn` 作为子域，借 OpenMCP 主域的权威与 SEO 权重，同时**在用户心智中保留「雷达」这个好记的词**。

**执行注意**

- `radar` 作为子域意味着无法签署独立商标。若未来要独立品牌化，路径是：先做子域积累 SEO 与口碑 → 再申请独立主域并做 301 跳转 → 商标注册放在主域确定之后。
- **不要使用 `vercelai.cn`**：与 Vercel（真实公司）高度近似构成商标混淆，且域名语义指向 AI 基建而非开源选型雷达，SEO 上会被 Vercel 相关词覆盖。`page.tsx` 中已硬编码的该域名需一并清除（见 §10-v0 工程任务 #1）。

#### 1.3.2 与 OpenMCP 主品牌的关系

雷达是 **OpenMCP 旗下产品**，不是第三家公司实体。对外签约主体仍是 OpenMCP；品牌层关系表述为：

```
OpenMCP
├── 市场（Market）      apps/web     —— 注册 / 网关 / 交易
└── 雷达（Radar）       apps/console —— 选型决策 / 持续监控
```

沿用 [OPENMCP_COMMERCIAL_PLAN.md](./OPENMCP_COMMERCIAL_PLAN.md) 决策 #11：**终端用户只见 OpenMCP 与 OpenWork**；「雷达」作为产品名出现，不涉及 LiteLLM 等实现层品牌。

---

## 2. 产品定位与边界

### 2.1 与 `apps/web` 的分工

| | **OpenMCP 雷达**（`apps/console`） | **OpenMCP 市场**（`apps/web`） |
|---|---|---|
| 回答的问题 | **「我该引入什么？它正在变好还是变坏？」** | **「我买了怎么用？多少钱？」** |
| 用户 | 技术决策者：架构师、CTO、Tech Lead、安全/合规 | Agent 开发者、Provider、付费用户 |
| 核心对象 | `repos` / `projects` / `tags` / `repo_weekly_stars` | `skills` / `mcp_servers` / `a2a_agents` / `personas` / `workflows` / `api_keys` |
| 核心信号 | 生态外部：star 增速、贡献者变化、发布节奏、许可证变更、CVE | 生态内部：安装、调用、付费、审核、安全评级 |
| 变现 | 组织级监控订阅（雷达自建收单，¥99/月 起） | 市场抽成 30%、网关用量、企业模块 |
| 复用 | **不共用**（决策 #3/#7） | ← 仅经 HTTP API 互取所需字段（§7.3） |

### 2.2 与 `openmcp-eval-v1` 的关系（重要）

`apps/web` 已有 `openmcp-eval-v1`（trust / reliability / adaptability / convention / effectiveness 五维，落在 `skills.metadata.evalReport`，`source: heuristic|llm|manual`），且明确**不覆盖** `securityGrade` 上架门控。

**雷达不得对 `skills` / `mcp_servers` 再造一套质量分。** 两者是正交的：

```
openmcp-eval-v1  =  这个 Skill / MCP Server「做得好不好」   （web 拥有，商品内）
OpenMCP 雷达信号 =  这个项目「在生态里是否正在变好/变坏」   （雷达拥有，生态外）
```

决策页展示时两者并列但**不合并成一个数字**。理由见 §4.3。

### 2.3 雷达的独特定位（不可复制清单）

竞品（OSSF Scorecard、deps.dev、Snyk、GitHub Trending、Gitstar-ranking、OpenAlternative、awesome-list）全部是**静态快照或只看增长**。雷达独占：

1. **Star 到达时间序列** —— 可算增速、可算加速度、可画断崖。竞品轮询日报，拿不到曲线。
2. **下行信号** —— Trending 类站点的商业模式是报喜，结构上不可能展示「这个项目在死」。这是 雷达的商业模式优势，不是劣势。
3. **我方相关性与付费验证** —— 复用 web 的 `skills.installs` / `provider_earnings` / `skill_verifications`，产出竞品不���的结论：「已有 N 个付费团队在生产环境验证」。

---

## 3. 核心价值主张

> **别人告诉你这个项目多受欢迎，我们告诉你它正在变好还是变坏。**

落地到三个签名组件（替代综合评分）：

**① 生命体征条 (Vitals Strip)** —— 4 个 sparkline + 变化率，替代六维评分条
```
⭐ 增速   ▁▂▃▅▇█▇  +820/周   ↑ 较上月加速 1.4×
👥 贡献者 ▁▁▂▂▃▃▃▂▃  3人(上季5)  ↓ -40%
📦 发布   ●───●───  21天未发布   均间隔 34天
🛡 风险   ⚠️ 中危 CVE 未修复
```

**② 证据气泡 (ⓘ)** —— 每个数字可展开来源 + 采集时间 + 原始序列
```
[48.2k ⭐  ⓘ]
  来源: GitHub GraphQL · 采集于 2026-09-30 08:12
  近 12 周: 41.2k → 43.8k → 45.1k → 47.4k → 48.2k
  本周 +820  ▁▂▃▅▇█▇  ← 来自 stargazer 时间戳
```
👉 **这一条就是全部护城河。** 别人只能写「48.2k」，我们能画曲线。

**③ 异动旗标 (Anomaly Flag)** —— 离散风险信号，带触发依据与时间轴
```
⬇ 增速断崖   近 3 周 +800 → +210 → +90            [时间轴]
⚠ 维护者流失  Top3 贡献者中 1 人 120 天未提交       [名单]
⚖ 许可证变更  v2.1.0 由 Apache-2.0 → AGPL-3.0        [commit]
✅ 已修复     CVE-2026-3811 已于 9/24 修复            [OSV]
```

---

## 4. 为什么砍掉综合评分（决策 #9 的论证）

### 4.1 竞品已免费覆盖

OSSF Scorecard（OpenSSF / CNCF / Linux Foundation 背书）已提供 `Maintained` / `Signed-Releases` / `Security-Policy` / `Branch-Protection` / `Code-Review` / `Packaging` / `CI-Tests` / `Fuzzing` 八个维度，且每个 CNCF 项目 README 上都挂着它的徽章。它被各大安全厂商集成，有方法论文档，免费。

> **把「六维尽调 92 分」当核心价值主张，等于用更高成本做一个更差的免费工具。**

### 4.2 GitHub 指标的加权和不是质量信号，是规模信号

`新增Star 35% + Fork 15% + Commit 15% + ...` 这类公式会系统性把「著名但已废弃」排在「小众但健康」之前。任何懂行的用户 5 分钟内能构造反例，而反例会永久留在页面上。**公开公式 = 主动提供攻击面。**

### 4.3 替代方案

| 原方案 | 替换为 | 理由 |
|---|---|---|
| 六维综合分 92/100 | **分类内相对分位** + **离散异动旗标** | 分位诚实、可跨项目解释；异动直接驱动决策，不需加权 |
| 「无已知 CVE = 安全」 | **只展示 OSV 已确认的漏洞**（`✅ 已修复` / `⚠️ 未修复`），不给「安全分」 | 「0 CVE」更常见的解释是没人扫过；给分会奖励冷门项目、惩罚被认真审计的项目 |
| 「核心贡献者 28 人」 | **贡献者变化率**（近 30 天新增 vs 上季度、Top 贡献者失活） | 绝对数是噪声，只有变化率是信号。console 已在采 stargazer 时间戳，同理可采 commit 时间戳 |
| 自定义权重滑块 | **异动筛选规则**（`仅下行` / `仅风险` / `仅许可证变更`） | 用户配权重也是错的目标；筛「我关心的变化」才是 |

**保留的**：`⚠️` 风险旗标、分类内分位、数据来源与采集时间全公开、事实与推断严格分离。

---

## 5. 数据架构：现状与增量

### 5.1 已实现（可直接复用）

| 能力 | 位置 | 说明 |
|---|---|---|
| 仓库元数据 | `src/lib/github/repo-info-query.ts` → `repos` | stars / forks / watchers / commits / contributors / releases / topics / languages / licenseSpdxId |
| **stargazer 时间戳** | `src/lib/tasks/tasks/snapshot-stars.ts` → `repo_weekly_stars` | **核心资产**。2s/repo、并发 1、跳过 >50k star、已扫过则跳过 |
| Star 历史 | `snapshots`（月）+ `repo_weekly_stars`（周） | 月增量 = 累计值差分；周增量 = 直读 |
| 周/月榜单 | `src/lib/github/service/rankings.ts` | 已按周期增量（delta）排序，**方向正确，不要改成总量排序** |
| Rising Stars | `src/lib/github/service/rising-stars.ts` + `rising_star_categories` | 已有 `tags` / `excluded` / `excludedTags` / `disabled` 配置 |
| 分类法 | `tags`（`code` / `aliases` / `excludeFromRankings`）+ `projects_to_tags` | **目前全人工**，见 §5.3 |
| 对外 JSON | `/api/rankings/{week,month,rising-stars}.json` | **公开无鉴权** — 数据出口已通 |
| 机器入口 | `/api/v1/repos`（`repos:write`）、`/api/v1/projects`（`projects:write`） | M2M 写入口，`api_keys` 逐 key scope |
| 定时调度 | `/api/cron/github`（Vercel Cron `0,30 * * * *`）+ `src/lib/tasks/registry.ts`（14 个任务） | |
| 中文翻译 | `src/lib/ai/translator.ts` | OpenAI → DeepSeek → Ollama fallback（`src/lib/env.ts:187`） |
| 权限模型 | `src/lib/auth/role.ts` | `role === "admin"` 才进 `/dashboard` |
| **项目趋势面板** | `src/components/projects/project-trends.tsx`（291 行） | ✅ **已实现**。读 `snapshots`（月度累计）+ `repo_weekly_stars`（周增量）双序列；**展示 delta 而非累计值**（避免「每月稳定 +12」被误读为尖峰） |
| **包体积面板** | `src/components/projects/project-packages.tsx` + `service/package.ts` | ✅ 已实现 |
| 详情/列表限流 | `src/lib/rate-limit.ts`（Redis） | ✅ 已实现 |
| console 独立用户列 | `user` + `banned` / `banReason` / `banExpires` / `customerId`（迁移 `0007_console_user_ban_columns.sql`） | ✅ 两侧 `user` 表各自演进，**是决策 #7「完全分离」的直接证据** |

### 5.2 已设计但未实现（阻塞项）

| 缺口 | 证据 | 影响 |
|---|---|---|
| **web 侧 `/api/webhook/daily` 不存在** | `apps/web/src/app/api/webhook/` 只有 `alipay/` `wechat/`；`design-github-repos-skills-webhook-sync.md` 已写完设计但未落地 | **§7 协同漏斗当前断在这里**，是 v1 的 P0 |
| console 侧推送目标未接线 | `src/lib/env.ts:65-73` 有 `GITHUB_DATA_WEBHOOK_URL` / `WEEKLY_WEBHOOK_URL` / `MONTHLY_WEBHOOK_URL` / `SKILLS_WEBHOOK_URL`，但 web 无接收端 | 同上 |
| 分类无自动化 | `service/tag.ts` 全部靠 `setProjectTags` 人工；`SKILL_MARKERS` 注释明确写「It is not a classifier」 | 分面检索无法规模化（§5.3） |
| 雷达侧缺 `tags` 承载 | web 已给 `skills`/`mcp_servers`/`a2a_agents`/`workflows` 加 `tags` jsonb + GIN（迁移 `0007`），但**不回写雷达** | 雷达需自建（§5.7），v0 前置 |
| **无向量 / 无语义检索（结论不变）** | web 侧 catalog 搜索为 `ILIKE` + `tags @>`，迁移 `0007` 注释明写 `no Meilisearch in this batch`；全仓无 `embedding` / `vector` 字段 | **`recommend_assets` 是「结构化检索 + reason 文案」，不是 RAG**。chat 仍不可前置（§10-v2） |
| 无 CVE 采集 | `repos` 无漏洞相关列 | 「安全与合规」Tab 无数据源 |
| 无贡献者时间序列 | 只有 `contributorCount` 标量 | 「维护者流失」异动做不出来（§5.4） |

### 5.3 待新建：AI 自动分类（v1 必须）

现状 `src/lib/ai/` 只做中译英。参照 `apps/web/src/lib/skills/enrich-skill-by-ai.ts` 的成熟模式（zod `Output` 约束 + 限定分类枚举 + 失败不抛错），在 console 侧新建：

| 产出 | 用途 | 形式 |
|---|---|---|
| `classification` | 分类法打标，替换人工 `setProjectTags` | 从**封闭枚举**里选，附 `confidence` + `evidence`（README 中的依据句） |
| `capabilities` | 能力属性（用途 / 语言 / 部署形态 / 认证方式 / 依赖的数据源） | 结构化可过滤字段，**不是** jsonb 里的自由词——这是分面检索和 chat 能用的唯一形式 |
| `scenario` | 一句话适用场景 | 短文本，进卡片 |

设计要点：
- **封闭分类法 + 开放属性两层结构**。纯自由标签必然失控；纯封闭分类法无法回答「哪些支持 Postgres」。
- **分类法正交拆两轴**：`category`（做什么）× `deployment`（self-hosted / SaaS / API）。现方案把「自托管」当成分类是错的。
- **human-in-the-loop 形态是「批量确认」**：`tags` 表加 `confidence` / `evidence` / `reviewed_at`，运营只做确认，10x 杠杆。
- **成本不是问题**：2000 仓库 × 单次调用 = 分毛级；直接复用现有 fallback 链。
- **只跑新增/变更**，不重跑全量（`snapshot-stars` 的限流预算不能被破坏）。
- **上线前先标 100-200 条 golden set**，没有它就改 prompt 属于盲飞。

### 5.4 待新建：异动检测（护城河本体）

异动是 v1 的**核心新增**，不是附属功能。规则引擎，跑在 `repo_weekly_stars` 与事件对比之上：

| 异动类型 | 触发条件（初版） | 所需数据 | 数据来源 |
|---|---|---|---|
| ⬇ 增速断崖 | 近 3 周增速单调下降且 `w3 < w1 × 0.4` | `repo_weekly_stars` | ✅ 已有 |
| ⬆ 异常加速 | `w1 / w3 > 3` 且绝对值 > 阈值（防小基数噪音） | `repo_weekly_stars` | ✅ 已有 |
| ⚠ 维护停滞 | 距上次 release > `2 × 历史中位间隔` 且 > 60 天 | releases + `pushedAt` | ✅ 已有 |
| ⚠ 维护者流失 | Top N 贡献者中有人 `> 120 天` 无 commit | **贡献者 commit 时间序列** | ❌ **待采** |
| ⚖ 许可证变更 | `licenseSpdxId` 前后不一致 | 需保留历史值 | ⚠️ 现只存当前值，**待改为快照** |
| 🛡 漏洞 | OSV / GitHub Advisory 新收录 | ❌ **待接** | 新增采集任务 |
| ⬇ 位次下滑 | 分类内分位较上周期下降 ≥ N 位 | `repo_weekly_stars` + `tags` | ✅ 已有 |

**三条工程红线**：
1. **误报率优先于召回率。** 宁可漏报不可滥报——一个天天误报的信号站会被用户整体忽略。
2. **每条异动必须附原始时间轴/名单/commit**，不可只给结论。
3. **必须有「我们也会说」栏目**展示健康加速项，证明警报未被滥用。

### 5.5 报告中心 → 决策留痕（v1 后置，v2 必做）

v1 只做「可分享链接 + 每周邮件摘要」。PDF / Excel / 审批流后置。

**但「30/90 天决策回访」必须在 v2 排上**：生成报告不是终点，指标是「决策对了没有」。回访同时是留存钩子与数据飞轮（真实决策理由 >> LLM 生成的推荐）。

### 5.6 技术栈约束（已锁定）

| 约束 | 理由 |
|---|---|
| **Next.js App Router** | console 当前基于 Next.js 16 + App Router。**禁止迁移到 TanStack Router / React Router**。`page.tsx` 当前 WIP 已不符合此约束，v0 必须恢复为 Next.js App Router 路由模式。 |
| **shadcn 原生 `table`** | 使用 `@workspace/ui` 的 shadcn 组件，不引入第三方表格库。列表页改造时优先复用现有组件。 |
| **禁止引入第三方路由** | 统一技术栈，减少打包体积和维护成本，避免 routeTree.gen.ts 类文件污染。 |

### 5.7 tags 字段策略（web 不回写）

| 约束 | 说明 |
|---|---|
| **不复用、不重复造** | web 的 `catalog_assets`、`search_assets`、`recommend_assets` 属 web 自有。雷达不调用、不依赖、不镜像。 |
| **web 不回写 console** | web 的 `tags` jsonb + GIN 索引仅作用于 `skills/mcp_servers/a2a_agents/workflows` 四张 web 表。**这些数据不会回写雷达**。 |
| **雷达自建字段** | 为维持结构化筛选能力，雷达需**自建对应表或字段**承载能力标签（`tags` / `capabilities`），便于后续筛选与自动分类（§5.3）。不与 web 的 schema 强耦合，满足「完全分离」（决策 #7）。 |
| **单向同步原则** | console → web 的 webhook（§7.2/§7.3）只推送必要的基础数据；不推送雷达内部的分类结果，也不消费 web 的 `tags`。 |

### 5.8 落地页重构（必须按本方案修订）

当前 `apps/console/src/components/landing/*` 和 `page.tsx` 的落地页**按旧线框实现**，与本方案决策 #9（不引入 0-100 综合分）、定价原则（个人永久免费、取消按次计费）及品牌（OpenMCP 雷达、域名 `radar.openmcp.cn`）存在以下冲突，**v0 必须修订，不得直接上线**：

| 冲突点 | 现状 | 修订后 |
|---|---|---|
| 综合分 | 显示「六维评分 92」 | **移除 0-100 综合分**，改为**生命体征条（Vitals Strip）** + **异动旗标（Anomaly Flag）**（§3） |
| 评分公式 | 明确写「六个维度独立计分后加权汇总，权重可按团队关注点自定义，评分公式公开、结果可复现」 | **删除该段落**。改为「数据可追溯，每个结论可点开查看来源与采集时间」（§4.3）。不公开加权公式。 |
| 定价（USD/CNY） | `$0 / $19 / $99 / 定制`，Free 含「每日 3 次 AI」 | **按文档定价**：`¥0 永久免费 / ¥99/月 Pro / ¥999/月 Team / 定制 Enterprise`。**取消按次计费**（删除「每日 3 次 AI」限额）。仅保留组织级「监控 + 协作」订阅作为付费点（§6.1） |
| AI 选型 | 首页/hero 强调 AI 选型助手 | **降级到 v2**（路线图 §10）。v0 落地页不突出 AI 助手，突出「异动优先（报衰不只报喜）」和「证据链」 |
| 域名 / SEO | `page.tsx` meta 硬编码 `vercelai.cn` | 改为 `radar.openmcp.cn`，title/description 按「OpenMCP 雷达」品牌更新 |
| 路由 | `page.tsx` 使用 `@tanstack/react-router` 的 `createFileRoute`（WIP） | **恢复为 Next.js App Router**（默认导出页面组件），移除 TanStack Router 相关代码（§5.6） |
| 文案 | 强调「六维尽调」 | 强调「证据链 + 异动检测 + 时间序列曲线」（§3 核心价值） |

**修订原则**：不改动现有组件结构大框架的前提下，先删除与本方案冲突的表达，再补充生命体征条、异动优先的三个签名组件。




### 5.9 视觉与主题规范（分层一致，决策 #15）

> **问题起点**：`apps/console` 与 `apps/web` 共用同一份 `packages/ui/src/styles/globals.css`，且**双方均未覆盖任何 token**。当前「完全一致」是继承的结果，不是有意的决策。同时 console 的落地页是 web 营销漏斗的**结构克隆**（同为 hero→能力→证明→定价→CTA，同紫色、同圆角、同组件），用户在视觉上无法分辨这是不同产品。

#### 5.9.1 分层原则

| 层 | 范围 | 规则 |
|---|---|---|
| **L1 信任层**（必须一致） | 字体栈、`--radius` 圆角阶梯、间距节奏、按钮/表格/卡片的**解剖结构**、暗色模式、i18n、动效词汇、可访问性基线、OpenMCP logo 锁定组合 | **不 fork 共享组件库**。为零用户收益去分叉 `@workspace/ui` 会使维护成本翻倍 |
| **L2 定位层**（应当不同） | 视觉主色语义、信息密度、落地页首屏逻辑、语气、签名组件 | 见 §5.9.2 |

#### 5.9.2 L2 具体差异

| 维度 | web（OpenMCP 市场） | 雷达 |
|---|---|---|
| **视觉主色** | 紫 `--primary: oklch(0.518 0.253 323.949)` = 行动/交易色，CTA 使用 | **不使用紫做主色**。转向 instrument palette（青蓝/石板灰）= 仪器、冷静、密度。紫**仅保留在 OpenMCP logo 内**作为品牌锚点 |
| **信息密度** | 低：大图、留白、少字段 | **高**：时间序列、delta、多列对比。列表行高比 web 收紧 |
| **落地页首屏** | 价值主张 + CTA | **实时异动 feed**——真数据、匿名可看前 N 条 |
| **语气** | 发现 / 获取 / 接入 | **报忧不报喜**：变坏、停滞、别再等了 |
| **签名组件** | catalog card + install 按钮 | Vitals Strip + Anomaly Flag + sparkline |

**理由**：雷达的核心主张是「**我们告诉你它在变坏，而不只是变受欢迎**」（§1.1）。这是**诊断语气**，而市场是**交易语气**。共用视觉语言会稀释雷达最值钱的那句话。

#### 5.9.3 涨跌配色：红涨绿跌 + 风险不靠颜色

**现状问题**：`rankings-content.tsx:186` 与 `deep-dives.tsx` 现用 `emerald`=好 / `amber`=警告，即**西方惯例**。但雷达是中文优先产品，中国用户预期是**红=涨、绿=跌**。

**已定方案（方案 A）**：

| 语义 | 颜色 | 说明 |
|---|---|---|
| 涨 / 加速 | **红** | `oklch(0.577 0.245 27.325)` 区间，走 shadcn `--destructive` 之外的独立 token `--radar-up` |
| 跌 / 衰退 | **绿** | `--radar-down` |
| 风险 / 异动告警 | **不靠颜色** | 靠**形状 + 文案 + 边框**：`AlertTriangle` 图标 + 「增速断崖」标签 + 左侧 2px 实心色条 |

**代价（已知并接受）**：风险信号的可扫视性略降，需靠图标与文案补足。**收益**：涨跌是雷达最高频的信息，遵循中文金融直觉的价值大于风险色的扫视便利。

**理由**：雷达的核心资产是 star 增速（§2.3），涨跌色是高频信息。若用西方惯例，中文用户每次读榜都要做一次心算翻转。

**方案 B（未采用，留档）**：蓝涨 / 橙跌 + 红色风险。违背中文直觉，但「仪表」感更强。若未来雷达扩展到证券类数据需再评估。

#### 5.9.4 首屏 = 实时异动 feed

落地页首屏**不再放六维评分或价值主张**，改为**真实的异动数据列表**：

- 数据源：`repo_weekly_stars` + 事件对比（§5.4），**匿名可看前 N 条**，无需登录
- 每条：`owner/repo` + 异动类型徽标 + delta 数值 + 证据摘要 + 时间轴入口
- 排序：按**绝对异动幅度**降序（而非增速百分比，避免小基数噪音霸榜）
- 硬性要求：**必须标注采集时间**（「数据截至 2026-09-30 18:00 CST」），可复现且不误导

**双重作用**：首屏差异化最有力的手段（一眼看出这不是商城）+ 最强 SEO/获客钩子（真实数据天然含长尾关键词，且内容持续更新）。

---

## 6. 商业模型

### 6.1 定价（个人免费，团队收费）

| 层级 | 价格 | 内容 |
|---|---|---|
| **Free** | ¥0 | 全量榜单、异动、详情、证据链、对比；个人 watchlist + 每日邮件摘要 |
| **Pro** | ¥99/月 | Slack / Webhook 告警 · 自定义异动规则 · 团队协作（负责人 + 评论）· 报告导出 · 决策留痕 |
| **Team / Enterprise** | ¥999/月 起 | SSO · 审批流 · 审计日志 · 合规导出 · 「我的代码库依赖相关性」检测 |

### 6.2 定价原则（与 `OPENMCP_COMMERCIAL_PLAN.md` 对齐）

1. **不卖信息。** 排行榜 / 异动 / 尽调全免费公开 —— 这是 SEO 与获客的燃料。原线框稿的「剩余免费额度 2/3 次」按次计费会抑制评估期最该鼓励的深度探索，且企业采购触发是合规审计要求而非偏好。**取消按次计费。**
2. **决策只发生一次，监控持续发生。** 这是唯一真实的续费理由，且绑合规/安全预算。
3. **不做付费软广位。** 自然排行与商业推广物理隔离（现有 `excludeFromRankings` / `promoted` 字段需配套审计规则）。
4. **利润重心在网关。** 雷达是漏斗顶部，`apps/web` 的网关与市场抽成是收银台（承接 `OPENMCP_COMMERCIAL_PLAN.md` 的 30% 抽成模型）。

### 6.3 转化漏斗（雷达 → 市场）

> ⚠️ **决策 #3/#7（账号独立 + DB 不合并）带来的固有摩擦**：用户在 雷达侧无账号，跨到 web 需重新注册。这是已知的获客损失，**由 §7.1 的签名 handoff 桥部分补偿，但无法完全消除**。雷达侧不做「假登录」暗示——转化率必须按真实新用户计。

```
雷达免费站                                OpenMCP 市场（apps/web）
──────────────────────────────────────────────────────────────
搜索 / 榜单 / 异动            （免费，SEO 入口，无账号门槛）
   ↓ 发现「这个 MCP Server 值得试」
项目详情 + 证据链              （免费，建立信任）
   ↓ 想直接用
[在 OpenMCP 接入]  ──── 签名 handoff（带 source + 项目标识 + 落地页意图）
   ↓                                              → mcp_servers / api_keys
   ↓                                              → 充值 / 按次付费
   ↓
雷达侧团队场景
Pro / Team 订阅（¥99 / ¥999，雷达自己的账号与支付）
   ↓
监控告警 → 风险变化 → 重新评估 → 再次跳转接入
```

**关键约束（决策 #3 后）**：
1. **两侧各自收单**。雷达的订阅收入走雷达自己的账号与支付，**不经手 OpenMCP 的 `balances` / `rechargeOrders`**——这是「完全分离」的直接后果。
2. **不做身份合并**。用户需在两侧各注册一次，这是明确接受的代价。
3. **归因靠签名 handoff，不靠共享账号**（§7.1）。没有它，雷达无法证明自己带来了多少市场收入，也就无法向团队证明该给雷达多少资源。
4. **雷达的商业价值因此不能只算订阅**。它对 OpenMCP 的贡献是**市场供给侧的需求发现**（哪些项目在被选型、哪些在衰减），这条价值链走数据 API（§7.3），不走用户账号。

---

## 7. 与 `apps/web` 的协同契约（P0）

> 这是本方案工程量最大、也最容易做错的部分。

### 7.1 决策 #3 的落地：账号完全独立 + 签名 handoff 桥

**已锁定**：两侧账号各自独立，不共享 `user` 表、不共用会话、不做身份合并。

| | 雷达（console） | OpenMCP 市场（web） |
|---|---|---|
| DB | `CONSOLE_DATABASE_URL` | `DATABASE_URL` |
| `user` 表 | 本地覆写版（多 `phoneNumber` / `phoneNumberVerified`） | `packages/db/src/auth-schema.ts` |
| 支付 | 自己的收单 | `balances` / `rechargeOrders` / 微信 / 支付宝 |
| 会话 | 独立 cookie | 独立 cookie |

**注**：`apps/console/src/lib/auth/role.ts` 的注释声称「`apps/web` reads the same column」。该说法在「完全分离」的决策下不再被依赖——两侧各自持有自己的角色判定，**不要在后续设计中引用这条注释作为前提**。若它已造成误导，建议后续单独提 PR 修正。

#### 必须补偿的摩擦

账号独立会让 §6.3 的漏斗损失一整步注册。补偿手段是**签名 handoff**，它不做身份合并，只做**跨站意图传递与归因**：

```
GET https://radar.openmcp.cn/api/handoff?target={slug}&intent=install&plan={pro|free}
   ↓ 雷达签发短时效令牌（HMAC，payload = {target, intent, plan, exp, nonce}）
   → 302 https://www.openmcp.cn/mcp/{slug}?h={token}
   ↓
GET https://www.openmcp.cn/api/handoff/consume?t={token}
   → 校验签名 / 过期 / 重放（nonce 一次性）
   → 写一条 attribution 记录（source=radar, target, intent, ts）
   → 清理 token，返回原落地页
```

**硬约束：**
1. **不传身份**。token 里**不含**任何用户标识、邮箱、手机号。两个系统对「这是谁」互不知情。
2. **短时效 + 一次性**。建议 `exp ≤ 10 分钟`，nonce 消费即作废，防重放。
3. **常量时间比较**，沿用 雷达侧 `src/lib/cron/guard.ts` 的 fail-closed 约定。
4. **可关闭**。`CAIRN_HANDOFF_SECRET` 未配置时整个路由返回 404（与现有 token 路由一致）。
5. **不含支付**。支付永远发生在 web 侧自己的收单流程里，handoff 只传「看了哪个项目、想干什么」。

**这条桥是唯一被允许的跨站耦合**，除此之外两侧无任何直接依赖。

### 7.2 阻塞项：web 侧 webhook 接收端缺失

设计已在 `design-github-repos-skills-webhook-sync.md` 写完，但 `apps/web/src/app/api/webhook/` 下只有 `alipay/` 与 `wechat/`，**`/api/webhook/daily` 未实现**。雷达侧的 `GITHUB_DATA_WEBHOOK_URL` / `WEEKLY_WEBHOOK_URL` / `MONTHLY_WEBHOOK_URL` 没有对端。

**落地顺序**：先实现 web 的 `/api/webhook/daily` 与 `/api/webhook/daily/skills`（按既有设计的字段映射），再接线 雷达侧推送。

**注意**：由于决策 #7 限定「仅经 HTTP API 交互」，这条 webhook 是**完全符合约束的**——它是标准的单向 POST，无共享库、无跨库读写。

### 7.3 契约定义

console → web 的数据流分两类，**方向必须单向**：

```
┌─ 雷达 → 市场（证据与需求信号，单向推送）──────────────────────┐
│                                                              │
│  console 产出                        web 消费                │
│  ────────────────────────────────────────────────────────    │
│  repos 元数据 + 快照            →  repos / repo_snapshots      │
│  作者信息                        →  authors                    │
│  Skills（已翻译）               →  skills                      │
│  ⭐ 周增量 / 增速 / 分位          →  （新）marketplace_signals  │
│  ⚠ 异动旗标                       →  （新）listing_alerts       │
│  许可证变更                       →  （新）license_changes      │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌─ 市场 → 雷达（商业元数据，单向回读）────────────────────────┐
│                                                              │
│  web 产出                        雷达消费                   │
│  ────────────────────────────────────────────────────────    │
│  skills.price_type / price_amount → 决策页价格展示            │
│  skills.grade / certified          → 「已认证」旗标          │
│  skill_installs / downloads        → 「N 个团队在用」          │
│  provider_earnings                 → 「N 个付费团队验证」       │
│  securityGrade                     → 安全旗标（不参与雷达评分）│
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**规则（全部受决策 #7「仅经 HTTP API」约束）：**
1. **GitHub 采集只在雷达 做一次**，web 不重复采集（省 GitHub API 预算 + 避免两份数据漂移）。这条正是决策 #8 在「不合并 DB」约束下**唯一可行的省预算方式**。
2. **两侧各自拥有自己的表**。web 侧新增的信号表归 web 所有，雷达不写 web 的任何业务表；雷达的表 web 也不读。
3. **同步必须幂等**（`full_name` + `date` 唯一键，`ON CONFLICT DO UPDATE`），允许重复投递。
4. **允许最终一致**，但商品价格 / 认证状态这类影响购买决策的字段要求 ≤5 分钟延迟；星标增量允许 T+1。
5. **所有推送 fail-closed**（沿用 `src/lib/cron/guard.ts` 的常量时间比较 + 未配置返回 404 约定）。
6. **雷达数据出口优先复用已公开的 `/api/rankings/*.json`**，先加 JSON 消费方，暂不动现有路由。
7. **禁止的实现方式**（决策 #7 的红线）：跨库连接、`dblink`、共享 schema 文件外泄、读取对方的 `DATABASE_URL`。**任何一侧的迁移都不得影响另一侧。**

### 7.3.1 决策 #7 的编译期红线：`apps/console` 不得 import `@workspace/db` / `@workspace/auth`

决策 #7 此前只在**部署**层成立（两个 `DATABASE_URL`），在**编译**层是破的。console 单独部署、单独数据库，因此它对 web/api 的包**零依赖**——但依赖曾经真实存在，且**运行时不报错**，所以一直没被发现：

| 位置 | 曾经的依赖 | 为什么运行期不炸 | 现状 |
|---|---|---|---|
| `src/db/schema.ts` | `export * from "@workspace/db/schema"`（web 全部 86 张表） | 查询只用到其中少数表，其余从未被 import 到执行路径 | 已移除；console 自建四张 auth 表 + `github` schema |
| `tsconfig.json` `paths` | `@workspace/db` / `@workspace/db/schema` 指向 `../../packages/db/src/*` | 只是类型别名，不产生运行时依赖 | **已删除**（这条是现在的实际防线，见下） |
| `next.config.mjs` `transpilePackages` | 含 `@workspace/db` | 只是把源码编进产物，没人 import 就不报错 | 已删除；产物只剩 `@workspace/ui` |
| `package.json` | **显式声明**了 `"@workspace/db": "workspace:*"`（已随本次移除，`pnpm-lock.yaml` 同步去掉该 link 边） | 声明让这层依赖在 pnpm 眼里完全合法，无任何告警 | 已删除；console 现在只声明 `@workspace/ui` 与 `@workspace/sms-captcha` |
| `src/lib/auth.ts` | 把 86 张表当 Better Auth 的 `schema` 传入 | Better Auth 只读它认识的那几张 | 随 schema 收窄一并修掉 |

**为什么必须在编译期拦住**：唯一的真实故障点在**迁移**。console 的 `drizzle-kit generate` 会按 schema 定义生成 DDL，一旦 schema 里混进 web 的表，产出的迁移就会在 `CONSOLE_DATABASE_URL` 里 `CREATE TABLE` 掉全部 86 张 web 表——而这条路径**完全不经过任何运行时检查**。这正是 E3 生成 `0008` 时实际发生的事（详见 §10 的 E3 记录）。

**现在的防线是类型系统本身**：两个包既不在 `package.json`，也不在 `tsconfig.json` 的 `paths` 里，所以任何 `import ... from "@workspace/db"` 都会让 `pnpm typecheck` 以 `TS2307: Cannot find module` 失败——这是一个**硬失败**，早于 lint、早于 review、早于部署。（这正是删除 `paths` 别名比删除 `package.json` 条目更关键的原因：只删依赖声明时，workspace 提升仍可能让 import 解析成功。）`apps/console/eslint.config.js` 另有一条 `no-restricted-imports` 用来补上「为什么」的解释（ESLint 9.39 会把该规则解析为 `error` 却仍按 warning 上报，且 console 的 `lint` 脚本没有 `--max-warnings 0`，所以它只是说明，不承担拦截责任）。

**允许的例外只有一个方向**：`console → @workspace/ui`（共享组件，即 §5.9.1 的 L1 层）与 `@workspace/sms-captcha`（后者只依赖 `@workspace/ui` 与外部包，无 db/auth 传递依赖）。**反方向（web 依赖 console）不存在**，也不允许出现。

### 7.4 决策 #10 的落地：两套排名完全分离

`apps/web` 已有 `skill_rankings`（`packages/db/src/mcp-schema.ts:625`），其 `popularityScore` **只由站内行为构成**：`recentViews` / `recentDownloads` / `recentLikes` / `recentComments` / `recentVerifications`。

**冷启动下这些字段全为 0，排序无区分度**，站点越冷越没信号。**这与决策 #7 是配套的**：正因为 DB 不合并、web 不采 GitHub 数据、也不经 API 取雷达增速，web 的榜**必然**只反映站内行为——这是被接受的取舍，不是缺陷。

**已锁定的语义分离：**

| | **雷达榜** | **OpenMCP 市场榜** |
|---|---|---|
| 拥有方 | 雷达（`apps/console`） | OpenMCP 市场（`apps/web`） |
| 数据源 | `repo_weekly_stars`（GitHub 外部） | `skill_rankings`（站内行为） |
| 语义 | 「整个生态里什么在火 / 在死」 | 「OpenMCP 上什么被用得最多」 |
| 冷启动 | 可用（day-1 有外部信号） | 不可用（需先有流量，接受） |
| 展示位 | 仅雷达站 | 仅市场商品页 |

**规则：**
- **互不取数。** 雷达不展示 `popularityScore`；市场不展示 star 增速作为主排序（决策 #7 已使技术上不可能，语义上也不应）。
- **不合并、不换算、不做「综合热度」。** 任何需要跨站热度对比的位置，一律**并列展示两个数字并标注来源与口径**，或干脆不展示。
- **命名上必须可区分**：雷达侧叫「生态热度 / 增速榜」，市场侧叫「站内表现」，**不共用「排行榜」这一个词**，避免用户误以为是同一份数据。
- **对比中心的排序基准由用户显式选择**（「按 GitHub 增速」/「按站内表现」），不设隐式默认。

**可复用资产**：雷达侧 `src/lib/github/service/rankings.ts` 已有 `byRelativeGrowth`（相对增速榜），与 §4.3 的「相对分位」诉求方向一致，v0 复用而非重写。

### 7.5 复用清单（不要重写）

| 复用 | 来源 |
|---|---|
| 分类与翻译 pipeline | `src/lib/ai/{provider,translator}.ts` |
| 定时调度与任务注册 | `src/lib/tasks/registry.ts` + `/api/cron/github` |
| fail-closed 鉴权 | `src/lib/cron/guard.ts` |
| M2M 写入口 | `/api/v1/repos`、`/api/v1/projects`（`api_keys` 逐 key scope） |
| 公开 JSON 出口 | `/api/rankings/*.json` |
| 分类法与人工打标 | `src/db/schema/github.ts` + `service/tag.ts` |
| **身份 / 账号** | **雷达自建**（决策 #3 各自独立）—— 复用 `@workspace/auth` 的**库**，但独立 DB、独立 session |
| **支付 / 收单** | **雷达自建**（决策 #7 不经手 web 的 `balances` / `rechargeOrders`）。见 §12.2 待决 7 |

### 7.6 明确不复用的 web 能力（决策 #12）

以下属于 web 的资产，**雷达不调用、不依赖、不镜像**（决策 #12「不复用，不重复造」）：

| web 能力 | 位置 | 雷达的对应做法 |
|---|---|---|
| `catalog_assets` 统一视图 | `packages/db/src/catalog-schema.ts` + 迁移 `0007` | 雷达**不查询**该视图（它存在于 web 的库内，决策 #7）。雷达用自身的 `repos` / `tags` |
| `searchCatalog` 搜索核心 | `apps/web/src/web/catalog/search.ts` | 雷达**自建**检索核心（pgvector + SQL facet，§10-v1） |
| `recommend_assets` 推荐 | `apps/web/src/web/catalog/recommend.ts` | **不复用**。雷达的选型逻辑（异动 + 证据链 + 实测记录）与商品推荐不同 |
| Store MCP `search_assets` / `recommend_assets` | `apps/web/src/lib/agent-install/store-mcp/tools.ts` | **不调用** web 的 Store MCP。雷达如需自建目录 MCP，另立独立包（§8） |
| `catalog.search` / `catalog.recommend` tRPC | `apps/web/src/web/catalog/router.ts` | 雷达**不调用**这些接口 |

**理由（不只是「不想复用」）**：两侧的**集合根本不同**。

| | 覆盖对象 | 规模 |
|---|---|---|
| web catalog | **已上架、可购买的商品**（`SKILLS_PUBLISH_POLICY.md` 门控通过） | 50+ Skills / 100+ MCP / 10+ A2A |
| 雷达 | **生态内全部开源项目**（含未上架、未通过门控、未商业化） | 数千 GitHub 仓库 |

强行复用会导致**雷达只能看到已上架商品，直接失去护城河**——雷达的价值恰恰在于覆盖那些还没上架、甚至永远不会上架的项目，并且能给出它们的下行信号。

### 7.7 品牌与文案约束

沿用

沿用 `OPENMCP_COMMERCIAL_PLAN.md` 决策 #11：**终端用户只看到 OpenMCP 与 OpenWork**。雷达是 OpenMCP 旗下产品（§1.3.2），不是第三个公司实体；对外签约主体仍是 OpenMCP。

---

## 8. 竞品防御

| 竞品 | 强在哪 | 我们的差异化 |
|---|---|---|
| **OSSF Scorecard** | 免费、CNCF 背书、方法论权威 | 我们**不重做**它。我们做它没有的：时间序列曲线 + 下行信号 + 我方相关性 |
| **GitHub Trending / Star History** | 流量巨大 | 它们**报喜不报忧**（商业模式决定）。我们首页第一屏是异动，含下行 |
| **deps.dev / Libraries.io** | 依赖与版本覆盖广 | 它们是数据字典，不是决策工具；我们输出「适合/不适合/需评估」 |
| **Snyk / Socket.dev** | 安全数据深 | 我们**不与它们比 CVE 广度**，只展示 OSV 已确认条目，导向做技术决策 |
| **OpenAlternative / awesome-list** | 人工策展、可信 | 它们静态且更新慢；我们有持续更新的时间轴与实测记录 |
| **Perplexity / AI 搜索** | 对话体验好 | 它们**没有实时数据**。我们的答案带「本周 +820 ⭐ / 21 天未发布 / 3 人已验证」—— 这是任何通用 LLM 给不出的 |

**唯一不可复制的资产**（按可复制难度排序）：

1. **社区实测记录**（真实生产环境规模 / 踩坑 / 替代了什么）—— 需要时间与运营，竞品无法生成
2. **我方依赖相关性与付费验证** —— 只有 web 的交易数据能产出
3. **stargazer 时间序列** —— 技术上可采（GitHub 允许），但成本与时间积累是壁垒

---

## 9. 风险与红线

### 9.1 法律 / 合规（必须过法务）

| 风险 | 说明 | 处置 |
|---|---|---|
| **README 再分发** | console 镜像 README 与 OG 图到 OSS（`src/lib/github/process-readme-*.ts`）。公开站展示 README 原文受原项目许可证约束，尤其 GPL/AGPL | 上公开站前确认展示边界（引用 / 摘要 / 全文）；`licenseSpdxId` 已有，需补「展示策略」字段 |
| **「商业支持 ✅」是法律风险** | 采购决策会基于它。谁验证？错了由雷达承担错误采购建议责任 | 必须做真：来源链接 + 验证时间 + 验证方式。或删除 |
| **CVE 表述** | 未修复 CVE 标红会产生大量误报（理论性 / 有争议漏洞） | 只展示 OSV 已收录；不做「安全分」；给出实际可利用性说明字段 |
| **评分公式公开** | 一旦公开，任何专家都能构造反例，信誉损失永久 | 已决策不发布综合分与权重（§4） |
| **web 侧 `hot_score` 公式已公开** | 迁移 `0007` 注释与 `packages/db/src/catalog-schema.ts` 均写明公式：`ln(1+downloads)*2.0 + recency*0.35 + security_weight + (certified?5:0) + app.popularity*0.01`。**这是 web 侧资产，雷达不继承、不修改**，仅记录风险供 web 参考 | （仅记录，不在本方案内处置）**风险**：(a) `certified ? 5 : 0` 把**商业/编辑认证**混入热度分 —— 一旦 `certified` 可付费获得，即等同于付费加权；(b) `age_days > 30` 后 recency 项恒为 0，榜单退化为纯下载量排序，新项目无法曝光；(c) 公式公开在 web 侧可接受（其权重基于真实行为数据），但**雷达绝不可复制此模式**（§4.2） |

### 9.2 技术 / 运营

| 风险 | 说明 | 处置 |
|---|---|---|
| **GitHub API 预算** | `snapshot-stars` 2s/repo 串行、跳过 >50k star；分类 / 异动 / 向量若挂全量会失控 | 分级：新项目全流程、存量只增量；加预算上限与降级 |
| **异动误报** | 天天误报的信号站会被整体忽略 | 误报率优先于召回；上线后人工复核前 200 条异动 |
| **分类法漂移** | LLM 自由产出导致标签体系失控 | 封闭枚举 + 版本化；每版跑 golden set 回归 |
| **双系统身份分叉** | 见 §7.1 | v1 第一个 P0 |

---

## 10. 路线图

### v0（4-6 周）：四个 surface，把护城河露出来

```
发现（分类导航 + 双轴筛选）
生态热度榜（真实 star 增速 + 分类内分位）
项目详情（证据链 + 趋势 + 异动）
全局对比（≤5，轻量）
```

- 砍掉：AI 选型助手、决策工作台 5 步流程、报告中心 / PDF / Excel、企业后台、自定义权重滑块、0-100 综合分
- 保留：证据气泡（每个数字可展开来源 + 时间）、异动旗标、风险信号
- 新增：生命体征条、社区实测区块（先人工收集 30-50 条种子内容）
- **同批完成**：独立域名与品牌落地（**`radar.openmcp.cn`**）、备案与 HSTS、canonical 与 `robots.txt`、OG 图
- **同批完成**：handoff 桥的**签发侧**（雷达侧签发 + 302）。web 侧消费可后置，未消费时降级为普通外链（§7.1）

#### v0 工程任务（阻塞其他一切，优先于页面开发）

| # | 任务 | 状态 | 依据 |
|---|---|---|---|
| **E1** | **回滚 `page.tsx` 的 TanStack Router** | ✅ **已完成** | 决策 #11（§5.6） |
| **E1b** | **补齐 landing 目录缺失的依赖与基础设施** | ✅ **已完成** | 见下表 |
| **E2** | **落地页按 §5.8 + §5.9 重构** | ✅ **已完成** | 决策 #1 / #9 / #15 |
| **E3** | **雷达侧 `tags` / `capabilities` 字段落地** | ✅ **已完成** | 决策 #13（§5.7） |
| **E4** | **列出页改用 shadcn 原生 `table`** | ✅ **已完成** | 决策 #11（§5.6） |

**E1 完成情况**：`page.tsx` 恢复为 Next.js App Router 默认导出，保留登录用户的 `landingPathFor` 分支（admin → `/dashboard`，其余 → `/console`，无会话 → `/sign-in`），匿名访客才看到落地页。已移除全部 TanStack Router 代码。

**E1b（实施中新发现，性质与 E1 同源）**：原 `landing/*` 目录是照着一套**仓库里不存在的依赖**写的，比路由问题更深：

| 问题 | 真相 | 处置 |
|---|---|---|
| `lucide-react` | **不在 `apps/console/package.json`**，未安装。console 的图标库是 `@tabler/icons-react`（web 才额外有 lucide） | 全部改为 `Icon*` 前缀的 tabler 图标 |
| `@/hooks/use-reveal` | **文件不存在** | 新建 `apps/console/src/hooks/use-reveal.tsx` |
| `--brand` / `--brand2` / `--aqua` / `--glass` / `--glass-border` / `--glass-strong` / `--font-display` / `.text-gradient-brand` / `.animate-floaty` | **全仓库无定义**，落地页原本**完全无色** | 新建 `apps/console/src/app/[locale]/landing.css` 定义值 |
| RSC 边界 | 8 个组件用了 `useState`/`useEffect` 但无 `"use client"` | 全部标记 |

**一个必须记住的 Tailwind 约束**：不 `@import "tailwindcss"` 的样式表（例如 `landing.css`，或按页面单独 import 的 css）里的 `@theme` at-rule **不会**被 Tailwind 展开——原生 CSS 能透传，Tailwind at-rule 不能。所以 `@theme inline` 的**注册**必须写在该 app 的 Tailwind 入口里，也就是 `apps/console/src/app/[locale]/globals.css`（它 `@import` 了 `@workspace/ui/globals.css`，两者同一编译单元）；原 `theme.css` 的雷达色值已并入该入口，文件本身已删除。注册与取值同文件、且与共享层分离，正是 §5.9.1「不 fork 共享组件库」的实现方式：注册是惰性的（web 不引用 `--brand` / `--radar-*` 任何类名），值仍是雷达私有。

**E3 完成情况**：`0008_console_capabilities_and_tag_review.sql` 落地 `tags` 的 `confidence` / `evidence` / `reviewed_at`、`capabilities` + `projects_to_capabilities` 两张表及其索引外键。生成这次迁移时发现一个**早于本任务的 schema 越界**，必须记在这里：

| 问题 | 后果 | 处置 |
|---|---|---|
| `apps/console/src/db/schema.ts` 整体 `export * from "@workspace/db/schema"` | 那是 **web 的全部 86 张表**（blog/mcp/registry/catalog/workflow/personas/payment/oauth…），其中任何一张都不存在于 `CONSOLE_DATABASE_URL`。`drizzle-kit generate` 对着 `meta/0006_snapshot.json`（22 张 console 表）做 diff，产出的迁移会 `CREATE TABLE` 掉**每一张 web 表**，并重复添加 `0007` 已加的 `user` 四列 | schema 改为只声明 console 自己的四张 auth 表（`user` / `session` / `account` / `verification`）+ `github` schema，**不再 import 共享 schema** |
| `session` 表带 `active_organization_id` / `impersonated_by` | 那是 better-auth **organization 插件**的列，而 console 的 `src/lib/auth.ts` 只装了 `phoneNumber` + `openAPI`，从未装 organization。每次 `generate` 都会试图给 console 的库加这两列——一个无插件读取、却会一直重发的纯漂移 | 随上一条一并改为 console 自有定义（列名/类型与共享表逐字对齐，但不再由 import 自动继承） |
| `meta/` 缺 `0007_snapshot.json`（`0007` 是手写迁移） | 快照链断在 `0006`，下一次 `generate` 必然把 `0007` 的 DDL 重发一遍 | 补齐 `0007_snapshot.json`，使链连续；`0007` 的 `when` 时间戳保持原值不动 |

**这一条的真正意义**：决策 #7「完全分离」此前只在**部署**层成立（两个 `DATABASE_URL`），在**schema 定义**层是破的——console 的迁移工具一直在按 web 的表结构生成 DDL。这不是新引入的风险，是既有风险被 `generate` 第一次真正跑出来。完整清单与编译期红线见 **§7.3.1**。（`src/lib/auth.ts` 之前把全部 86 张表当作 Better Auth 的 `schema` 传入，也一并修掉。）

**E4 完成情况**：两处列表页本来就已经用 `@workspace/ui` 的 shadcn 原生 `Table`，无需引入任何第三方表格库，本次改的是**语义与密度**：

| 问题 | 真相 | 处置 |
|---|---|---|
| `rankings` 的 delta 固定 `text-emerald-600` | 星标**下跌**的项目被涂成绿色好消息；红涨绿跌是中国市场惯例，与 web 的涨跌色相反 | 改用 `--color-radar-up` / `--color-radar-down` / `--color-radar-flat`（§5.9.2） |
| delta 格式化硬编码 `+` 前缀 | 负数渲染成 `+-120` | 改为按符号分支：正 `+N`、负 `−N`（U+2212）、零 `0` |
| 仅靠颜色传达方向 | 色觉障碍与灰度打印下不可读 | 补 `IconChevronUp` 箭头（下跌时旋转 180°），颜色是第二通道而非唯一通道 |
| 数字列未对齐 | `text-right` 但非等宽数字，跳动时列会抖 | 数值列统一 `tabular-nums`；表头行 `hover:bg-transparent`，行高收紧一档 |

**未改动**：`status-badge.tsx` 的 emerald 是**状态色**（同步成功），`skills-content.tsx` 的 emerald 是**布尔真值**（是否具备），都不是市场涨跌，按 §5.9.2「语义色不得复用」保持原样。

**退出标准**：搜索成功率、详情→对比转化率、分享率、handoff 点击率、外部回访。

### v1（+6-8 周）：护城河本体 + 协同闭环

1. **打通雷达 → web 数据通道**（§7.2 webhook 接收端 + §7.3 契约）—— **P0，先于任何新功能**
2. **handoff 消费侧**（web 的 `/api/handoff/consume` + attribution 记录），完成归因闭环
3. AI 自动分类（§5.3）+ 批量确认 UI（扩展 `tags` 表）
4. 异动检测引擎（§5.4）+ 异动页（含「我们也会说」栏目）
5. 结构化检索 API（pgvector + SQL facet）
6. watchlist + 邮件摘要

**退出标准**：web 侧收到信号表数据；handoff 归因可用；异动误报率 < 5%；分类 golden set 准确率达标。

### v2：收费与留存

1. Pro / Team 订阅 + 支付（**雷达自己的收单**，决策 #3/#7 下不经手 web 的 `balances` / `rechargeOrders`）
2. Slack / Webhook 告警
3. 团队协作（负责人 + 评论 + 审批流）
4. 决策留痕 + 30/90 天回访
5. 「我的代码库依赖相关性」检测（≤2 跳）
6. AI 选型助手（**必须最后做**：先有结构化检索能力，chat 只服务长尾）

### 铁律：先验证付费假设

**第 1-2 周做用户访谈：10 个近 6 个月真实做过开源选型的技术负责人。**问三件事：产出了什么文档、谁签字、为什么选 A 不选 B、愿意为哪个具体环节付钱。

> 这几天的成本能省掉后面 6 个月。原线框稿把风险最高的假设（企业愿否为选型付费）埋在工程量最大的 AI 助手和六维评分之下——顺序是反的。

---

## 11. 度量

| 层 | 指标 | 目标（v1 后 90 天） |
|---|---|---|
| **北极星** | 周决策回访完成数（30/90 天回访中确认「已决策」的比例） | 建立基线后再设目标 |
| 获客 | 自然搜索占比 · 分享链接回访率 · 周报邮件打开率 | 搜索占比 > 60% |
| 漏斗 | 搜索成功率 · 详情→对比 · 对比→订阅 | ≥ 25% |
| **跨站（受决策 #3 影响）** | handoff 点击率 · handoff 后 web 侧注册转化 · **双侧注册完成率** | 建立基线；双侧注册完成率是本决策的**唯一止损指标** |
| 信任 | 证据气泡展开率 · 异动点击率 | ≥ 15% |
| 质量 | 异动误报率 · 分类准确率（golden set） | 误报 < 5% · 准确率 ≥ 85% |
| 协同 | 信号表同步延迟 · web 侧消费成功率 | ≤ 5min · ≥ 99% |
| 收入 | Pro/Team 付费数 · MRR · 续费率 | 由 v2 定义 |

---

## 12. 待决问题（需 owner 拍板）

### 12.1 已关闭（2026-09-30 由产品所有者锁定）

**第一批**（原 1-3 项）：独立域名与独立部署、账号各自独立、DB 不合并仅经 API 交互、两套排名完全分离。**§7.1 的「身份方案 A/B」选项作废**，改为签名 handoff 桥。

**第二批**（代码更新后的冲突项）：

| # | 问题 | 结论 | 落地位置 |
|---|---|---|---|
| 1 | 品牌叫什么 | **OpenMCP 雷达**。放弃「Cairn / 玛尼堆」及备选 Vigil / Barometer / Waypoint | §1.3.1、文件名 `CONSOLE_RADAR_COMMERCIAL_PLAN.md` |
| 2 | 域名 | **`radar.openmcp.cn`**。接受 `radar` 为通用词、无法独立注册商标的代价 | §1.3.1、决策 #1 |
| 3 | 落地页与决策 #9 冲突 | **改落地页**。不以现状为准 | §5.8、v0 任务 E2 |
| 4 | 定价冲突（`$0/$19/$99` + 每日 3 次 AI vs `¥0/¥99/¥999`） | **以本文档为准**。`¥0 永久免费 / ¥99 Pro / ¥999 Team / 定制`；**取消按次计费**，删除「每日 3 次 AI」 | §5.8、§6.1、v0 任务 E2 |
| 5 | 是否复用 web 的 catalog / Store MCP | **不复用、不重复造** | §7.6、决策 #12 |
| 6 | web 的 `tags` 数据是否回写雷达 | **不回写**。雷达自建对应表/字段承载能力标签 | §5.7、决策 #13、v0 任务 E3 |
| 7 | web `catalog_assets` + `hot_score` 公式 | **只标记风险**，不在本方案内处置。雷达不继承、不修改 | §9.2 |
| 8 | 是否引入向量 / 语义检索 | **结论不变：现在没有，未来也不照 web 的 ILIKE 模式做**。web 是 `ILIKE` + `tags @>`（迁移 `0007` 明写 `no Meilisearch in this batch`），`recommend_assets` 是结构化检索 + reason 文案，**不是 RAG** | §5.2 |
| 9 | 表格 / 路由技术选型 | **shadcn 原生 `table` + Next.js App Router，禁止引入第三方路由** | §5.6、决策 #11、v0 任务 E1/E4 |
| 10 | `page.tsx` 的 TanStack Router | **采用 Next.js App Router，不使用 TanStack Router**。当前 WIP 必须回滚 | §5.6、v0 任务 E1 |
| 11 | 两站视觉风格 | **分层一致，不是完全统一**。L1（字体/圆角/组件结构/暗色/i18n/可访问性）共用，**不 fork `@workspace/ui`**；L2（主色/密度/首屏/语气/签名组件）分离 | §5.9.1–5.9.2、决策 #15 |
| 12 | 涨跌配色 | **红涨绿跌**（中文金融直觉），**风险信号不靠颜色**——靠 `AlertTriangle` 图标 + 文案标签 + 2px 左侧色条。方案 B（蓝涨橙跌）留档未采用 | §5.9.3 |
| 13 | 落地页首屏 | **实时异动 feed**（真数据、匿名可看前 N 条、按绝对异动幅度降序、标注采集时间）。删除六维评分模块 | §5.9.4 |

### 12.2 仍待决

1. **社区实测的冷启动谁来做？** 没有它，护城河少一条腿。v0 就要开始人工收集，且这是**运营活不是工程活**，不排期就会烂尾。
2. **异动规则阈值**需不需要产品侧先跑 dry-run 看误报率再定线？（建议：是，先跑再定）
3. **README 展示策略**（引用 / 摘要 / 全文）需法务结论。
4. **`docs/PRODUCT.md` 被 `docs/design/README.md` 引用为「产品真相来源」但文件不存在** —— 需要补齐或在索引中修正，否则新文档的引用链是断的。
5. **`role.ts` 的注释修正**（§7.1 末段）是否单独提 PR。
6. **雷达侧支付通道**：决策 #7 下雷达需自建收单（微信 / 支付宝）或接入第三方（Stripe / 创蓝）。**这是 v2 的前置依赖，越早启动越晚拿到资质**，建议 v0 期间并行推进。

---

## 附录 A：现状能力对照（实现状态）

| 能力 | 状态 | 位置 |
|---|---|---|
| 仓库元数据采集 | ✅ 已实现 | `src/lib/github/repo-info-query.ts` |
| stargazer 时间戳扫描 | ✅ 已实现 | `src/lib/tasks/tasks/snapshot-stars.ts` |
| 周/月榜（按增量） | ✅ 已实现 | `src/lib/github/service/rankings.ts` |
| Rising Stars + 分类配置 | ✅ 已实现 | `src/lib/github/service/rising-stars.ts` |
| 分类法与人工打标 | ✅ 已实现（全人工） | `src/db/schema/github.ts` + `service/tag.ts` |
| 公开 JSON 出口 | ✅ 已实现 | `/api/rankings/*.json`、`/api/anomalies.json` |
| 生命体征（无综合分） | ✅ 已实现 | `src/lib/radar/vitals.ts` + `components/public/vitals-strip.tsx` |
| 证据时间轴 | ✅ 已实现 | `src/lib/radar/timeline.ts` + `components/public/evidence-timeline.tsx` |
| 公开异动页（§5.9.4） | ✅ 已实现 | `/anomalies`，与 JSON 出口同源同序 |
| 落地页首屏实时 feed（§5.9.4） | ✅ 已实现 | `components/landing/hero.tsx`，服务端取数 |
| 榜单行异动旗标（§5.9.3） | ✅ 已实现 | `components/public/public-project-list.tsx` |
| 误报率统计（§9.2） | ✅ 已实现 | `falsePositiveRate()` + `dismissAnomaly()` |
| 决策工作台（§5.5 轻量版） | ✅ 已实现 | `src/lib/radar/decisions.ts` + `routers/decisions.ts` + `/console/decisions`；体征**冻结**进候选行 |
| 决策工作台 5 步流程 | ❌ 按 §10 砍掉，只落轻量版 | — |
| 中译英 pipeline | ✅ 已实现 | `src/lib/ai/translator.ts` |
| admin 角色门控 | ✅ 已实现 | `src/lib/auth/role.ts` |
| web 侧 `/api/webhook/daily` | ❌ 设计有、未实现 | `design-github-repos-skills-webhook-sync.md` |
| AI 自动分类 | ❌ 未实现 | 参照 `apps/web/src/lib/skills/enrich-skill-by-ai.ts` |
| 异动检测 | ✅ 已实现（五类规则） | `src/lib/radar/rules.ts` + `tasks/detect-anomalies.ts`（迁移 `0017_radar_anomalies`、`0019_anomaly_magnitude`） |
| 贡献者时间序列 | ❌ 未采集 | 需扩展 `update-github-data.ts` |
| 许可证变更历史 | ✅ 已实现（快照式历史表） | `repo_license_history`（迁移 `0017`），由 `detect-anomalies` 幂等写入，不新增 GitHub 请求 |
| CVE / OSV 采集 | ❌ 未接 | 需新建采集任务 |
| 向量 / 语义检索 | ❌ 未实现（web 侧亦无，只有 `ILIKE` + `tags @>`） | 建议 pgvector |
| **项目趋势面板** | ✅ 已实现 | `src/components/projects/project-trends.tsx` |
| **包体积面板** | ✅ 已实现 | `src/components/projects/project-packages.tsx` |
| **console `tags` / `capabilities` 字段** | ✅ 已实现（迁移 `0008_console_capabilities_and_tag_review`） | 已在 `CONSOLE_DATABASE_URL` 库内自建；**AI 分类与审核 UI 尚未接线**（v1） |
| 贡献者变化率 | ❌ 未实现 | 依赖贡献者时间序列 |
| 付费 / 订阅 | ❌ 未实现（决策 #7 下**雷达自建收单**，不经手 web 的 `balances`） | §6.1、§12.2 待决 6 |