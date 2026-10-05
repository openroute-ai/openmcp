/**
 * Seeds the public radar pages with a demo dataset.
 *
 * `/rankings` and `/categories` read recorded counts rather than derived ones,
 * so an empty database renders two empty pages however much data the rest of the
 * app has. Filling them needs history at three cadences — the rankings refuse to
 * publish a period whose predecessor was never measured, and the project detail
 * chart reads a trailing window of daily arrivals — which is exactly what a
 * fresh install cannot have and what waiting for the GitHub sweeps would take a
 * season of schedules to produce.
 *
 * So this writes a history. One daily series per repository is the source, and
 * the weekly and monthly rows are summed from it rather than invented
 * separately: a coarse row whose level and change disagree with the daily rows
 * underneath it would be a period the pages cannot explain.
 *
 * Nothing here is random on purpose. The curves are keyed on each repository's
 * own numbers, so re-running produces the same rows and two pages can be
 * compared against each other.
 *
 * It is additive and keyed on natural keys (`repos.owner_name_index`,
 * `projects.slug`, `tags.code`, `(repo_id, period)`), so it is safe to run
 * against a database that already has rows: existing repositories, projects and
 * tags are updated in place and nothing is deleted.
 *
 *   pnpm db:seed:radar
 */

import { and, count, eq, inArray } from "drizzle-orm"
import { config } from "dotenv"

import type { RepoInfo } from "@/lib/github/repo-info-query"
import { periodStart, type StatsCadence } from "@/lib/github/snapshot-dates"
import { COUNTERS } from "../lib/github/service/stats"

config({ path: ".env" })
config({ path: ".env.local" })
config({ path: "../../.env", override: false })

/**
 * Days of history to write.
 *
 * Long enough that the monthly window below is complete inside it: twelve
 * trailing months need about 365 days, and the daily chart reads the last 90 of
 * whatever is stored, so one series covers every cadence.
 */
const HISTORY_DAYS = 400
/** Months of monthly rows, which is what the ranking's month view reads. */
const MONTHLY_MONTHS = 12
/** Weeks of weekly rows, over the 12-week window the detail chart shows. */
const WEEKLY_WEEKS = 26

/**
 * How long an open-issue count takes to swing from its peak back to its trough.
 *
 * Short enough that a daily tooltip shows movement on most days. An issue count
 * on a longer cycle would be as flat in the daily window as the counters that
 * only accumulate, and the daily window is the one the tooltip is read from.
 */
const ISSUE_CYCLE_DAYS = 9

/**
 * How much of its closing level each counter holds when the history opens.
 *
 * A share rather than a fixed number so the demo repositories all start from the
 * same proportion of their own size, and so 400 days of movement visibly moves a
 * counter rather than arriving on top of it.
 */
const OPENING_SHARE = 0.55

/**
 * The counters that have a level of their own, which is every counter but the
 * star arrivals.
 *
 * Derived from `COUNTERS` in the stats module rather than listed here, so a tenth
 * counter added there is seeded here too instead of silently becoming an em dash
 * in the tooltip.
 */
const LEVEL_COUNTER_NAMES = COUNTERS.filter(
  (counter): counter is typeof counter & { level: string } =>
    Boolean(counter.level)
).map((counter) => counter.name)

/** The nine counters a period's tooltip lists, stars first. */
const LEVEL_COUNTERS = LEVEL_COUNTER_NAMES as LevelCounterName[]

/** Every counter that has a level, including stars. */
type LevelCounterName = (typeof LEVEL_COUNTER_NAMES)[number]

/**
 * The counters the seed drives off the star series rather than off a profile.
 *
 * Stars are the dataset: their level *is* the series' closing level, and their
 * movement *is* the day's arrivals. Keeping them out of the profile maps is what
 * stops a second number for the same series from being free to disagree with it.
 */
type DerivedCounterName = Exclude<LevelCounterName, "stars">

/** The counters with a shape of their own in {@link COUNTER_PROFILES}. */
type ProfiledCounterName = DerivedCounterName

interface DemoRepo {
  owner: string
  name: string
  ownerId: number
  description: string
  tags: string[]
  projectDescription: string
  type: "application" | "skill" | "persona"
  language: string
  license: string
  /** Stars held before the seeded history opens. */
  baseStars: number
  /** Stars gained per week at the start of the history. */
  weeklyGain: number
  /** How much of the weekly gain is left by the end of the history. */
  retention: number
}

/**
 * The demo dataset.
 *
 * The curves differ from each other on purpose: a page where every row grew at
 * the same rate cannot show that the trending list and the relative-growth list
 * disagree, which is the only reason both exist.
 */
const DEMO_REPOS: DemoRepo[] = [
  {
    owner: "atlas-labs",
    name: "mcp-gateway",
    ownerId: 9001001,
    description:
      "An MCP gateway that fronts many model providers behind one tool surface.",
    tags: ["gateway", "infrastructure"],
    projectDescription:
      "把多个模型提供方收拢到一个 MCP 工具面之后，网关、能力协商与用量统计都在一处完成。",
    type: "application",
    language: "TypeScript",
    license: "Apache-2.0",
    baseStars: 1820,
    weeklyGain: 96,
    retention: 0.72,
  },
  {
    owner: "atlas-labs",
    name: "prompt-bench",
    ownerId: 9001001,
    description:
      "A benchmark harness for MCP prompts, with reproducible scoring.",
    tags: ["evaluation", "tooling"],
    projectDescription:
      "对 MCP 提示词做可复现打分，评分口径与数据集版本一起提交，方便回溯。",
    type: "application",
    language: "TypeScript",
    license: "MIT",
    baseStars: 640,
    weeklyGain: 41,
    retention: 0.55,
  },
  {
    owner: "northwind",
    name: "vector-bridge",
    ownerId: 9001002,
    description:
      "Keeps an embedded vector index in sync with an MCP server's tools.",
    tags: ["data", "infrastructure"],
    projectDescription:
      "把嵌入式向量索引与 MCP 工具定义保持同步，工具变更后索引自动重建。",
    type: "application",
    language: "Python",
    license: "MIT",
    baseStars: 2380,
    weeklyGain: 18,
    retention: 0.9,
  },
  {
    owner: "northwind",
    name: "schema-keeper",
    ownerId: 9001002,
    description:
      "Versioned migrations for tool schemas, with a dry-run planner.",
    tags: ["data", "tooling"],
    projectDescription:
      "工具定义的版本化迁移与演练式执行计划，破坏性变更先在预览里出现。",
    type: "application",
    language: "Go",
    license: "Apache-2.0",
    baseStars: 310,
    weeklyGain: 27,
    retention: 0.48,
  },
  {
    owner: "harborlight",
    name: "ops-console",
    ownerId: 9001003,
    description: "An operations console for a fleet of MCP servers.",
    tags: ["observability", "gateway"],
    projectDescription:
      "面向 MCP 服务集群的运维台：健康检查、调用链与配额在同一屏内对齐。",
    type: "application",
    language: "TypeScript",
    license: "MIT",
    baseStars: 1450,
    weeklyGain: 63,
    retention: 0.66,
  },
  {
    owner: "harborlight",
    name: "trace-viewer",
    ownerId: 9001003,
    description: "Reads MCP trace spans and renders them as a call waterfall.",
    tags: ["observability", "tooling"],
    projectDescription:
      "把 MCP 调用链的 span 读出来渲染成瀑布图，跨进程的调用顺序一眼可见。",
    type: "application",
    language: "TypeScript",
    license: "MIT",
    baseStars: 880,
    weeklyGain: 34,
    retention: 0.6,
  },
  {
    owner: "kestrelworks",
    name: "skill-forge",
    ownerId: 9001004,
    description: "Scaffolds MCP skill packages with a validated manifest.",
    tags: ["tooling", "skills"],
    projectDescription:
      "生成带校验清单的 MCP 技能包骨架，发布前的结构检查在脚手架里完成。",
    type: "skill",
    language: "TypeScript",
    license: "MIT",
    baseStars: 210,
    weeklyGain: 52,
    retention: 0.42,
  },
  {
    owner: "kestrelworks",
    name: "agent-personas",
    ownerId: 9001004,
    description: "Reusable personas for agent frameworks, packaged as skills.",
    tags: ["skills", "personas"],
    projectDescription:
      "以技能包形式分发的智能体人格模板，可直接挂到任意框架上。",
    type: "persona",
    language: "Python",
    license: "MIT",
    baseStars: 95,
    weeklyGain: 21,
    retention: 0.5,
  },
  {
    owner: "quiet-harbor",
    name: "tool-notes",
    ownerId: 9001005,
    description:
      "A notebook for comparing MCP tool descriptions before shipping them.",
    tags: ["evaluation", "skills"],
    projectDescription:
      "发布前对比 MCP 工具描述的笔记本：措辞差异与调用成功率放在一起看。",
    type: "application",
    language: "Jupyter Notebook",
    license: "MIT",
    baseStars: 58,
    weeklyGain: 9,
    retention: 0.8,
  },
  {
    owner: "quiet-harbor",
    name: "cache-sentry",
    ownerId: 9001005,
    description:
      "Caches tool responses with per-tenant budgets and eviction alerts.",
    tags: ["infrastructure", "observability"],
    projectDescription:
      "按租户配额缓存工具响应，超额即驱逐并告警，避免单个租户吃满缓存。",
    type: "application",
    language: "Go",
    license: "Apache-2.0",
    baseStars: 1320,
    weeklyGain: 12,
    retention: 0.94,
  },
  {
    owner: "harborlight",
    name: "alert-router",
    ownerId: 9001003,
    description:
      "Routes MCP server alerts to on-call rotations, with dedup windows.",
    tags: ["observability", "gateway"],
    projectDescription:
      "把 MCP 服务的告警按值班表路由，带去重窗口与静默期，避免一次抖动叫醒整组人。",
    type: "application",
    language: "Go",
    license: "MIT",
    baseStars: 760,
    weeklyGain: 44,
    retention: 0.38,
  },
  {
    owner: "northwind",
    name: "snapshot-store",
    ownerId: 9001002,
    description:
      "Content-addressed snapshots for tool responses, with a GC sweeper.",
    tags: ["data", "infrastructure"],
    projectDescription:
      "以内容寻址存放工具响应快照，配合定期清扫，既可回放也能复现当时的返回。",
    type: "application",
    language: "Rust",
    license: "Apache-2.0",
    baseStars: 1480,
    weeklyGain: 29,
    retention: 0.69,
  },
]

/**
 * The tags the demo projects are filed under.
 *
 * `excludeFromRankings` is left to the service default, which keeps the
 * operational code out of the rankings the way a curated database would.
 */
const DEMO_TAGS: { code: string; name: string; description: string }[] = [
  {
    code: "gateway",
    name: "网关",
    description: "把多个上游服务收拢到统一入口的代理与路由层。",
  },
  {
    code: "observability",
    name: "可观测性",
    description: "调用链、指标与日志，围绕运行状态而不是源码。",
  },
  {
    code: "tooling",
    name: "工具链",
    description: "开发、评测与发布工具本身，面向构建者。",
  },
  {
    code: "infrastructure",
    name: "基础设施",
    description: "部署、网关与存储这类支撑性组件。",
  },
  { code: "data", name: "数据", description: "索引、迁移与数据管道。" },
  {
    code: "evaluation",
    name: "评测",
    description: "可复现的基准、打分与对比。",
  },
  {
    code: "skills",
    name: "技能包",
    description: "以 MCP 技能形式分发的能力包。",
  },
  { code: "personas", name: "人格", description: "智能体人格与行为模板。" },
  {
    code: "meta",
    name: "内部标签",
    description: "运营用标签，不进入公开排行。",
  },
]

/**
 * The five owners behind the demo repositories, as the author directory records
 * them.
 *
 * Keyed on the owner rather than repeated per repository, because the author
 * outlives the project: one row per repository would be five copies of the same
 * person that a later edit could leave disagreeing with each other.
 *
 * The detail page reads the byline from here, so without these rows the author
 * card never renders and the demo shows a project with no author at all.
 */
const DEMO_AUTHORS: Record<
  string,
  {
    name: string
    bio: string
    followers: number
    verified: boolean
    homepage?: string
    twitter?: string
    npmUsername?: string
  }
> = {
  "atlas-labs": {
    name: "Atlas Labs",
    bio: "做模型基础设施的团队，网关、评测与可观测性都自己写。",
    followers: 18400,
    verified: true,
    homepage: "https://atlas-labs.dev",
    twitter: "atlaslabs",
  },
  northwind: {
    name: "Northwind Data",
    bio: "数据管道与检索基础设施，维护着几个被广泛嵌入的开源项目。",
    followers: 6200,
    verified: true,
    homepage: "https://northwind.example",
  },
  harborlight: {
    name: "Harborlight",
    bio: "云运维工具集，目标是把生产环境的排障过程写进脚本。",
    followers: 3100,
    verified: false,
    twitter: "harborlight",
  },
  kestrelworks: {
    name: "Kestrel Works",
    bio: "小团队，主要在做 agent 技能与人格包。",
    followers: 890,
    verified: false,
    npmUsername: "kestrelworks",
  },
  "quiet-harbor": {
    name: "Quiet Harbor",
    bio: "一个人维护的工具集合，更新频率不稳定。",
    followers: 240,
    verified: false,
  },
}

/**
 * The README stored for each demo repository, keyed on `owner/name`.
 *
 * Written here rather than left to the readme sync because there is no GitHub to
 * sync from: these repositories are fictional, so the task that fetches a README
 * from the API would find nothing and every demo project would render its detail
 * page with no document on it — the one part of the page that proves the markdown
 * renderer works would be the part that never showed anything.
 *
 * Each one is a different mix of Markdown on purpose. The detail page renders
 * whatever arrives through the same pipeline a real README does, so a demo made
 * of one repeated shape would only prove that shape works: the table, the fenced
 * block, the raw HTML `<details>` and the badge links all appear here because
 * each is something a real README uses and something the renderer has to get
 * right. No Chinese translations are seeded — the translation is a separate task
 * in the real pipeline, and a demo that faked it would hide that the English-only
 * state is a real one.
 */
const DEMO_READMES: Record<string, string> = {
  "atlas-labs/mcp-gateway": `# mcp-gateway

An MCP gateway that fronts many model providers behind **one** tool surface.

<p align="center">
  <img src="https://img.shields.io/badge/MCP-2025-11-blue" alt="MCP 2025-11" />
  <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="Apache-2.0" />
</p>

## Why

An agent written against one provider stops working the day you add a second.
This gateway keeps the tool surface stable and moves the differences — context
windows, streaming, tool-call quirks — behind it.

## Quick start

\`\`\`bash
npx @atlas-labs/mcp-gateway serve --config gateway.yaml
\`\`\`

A minimal \`gateway.yaml\`:

| Field | Required | Notes |
| --- | --- | --- |
| \`providers\` | yes | At least one entry. |
| \`toolPolicy\` | no | \`passthrough\` (default) or \`allowlist\`. |
| \`usage\` | no | Per-tenant counters; off when absent. |

## What it does not do

- It does not cache responses — see [cache-sentry](https://github.com/quiet-harbor/cache-sentry) for that.
- It does not judge whether a tool is healthy; that is what the radar is for.

<details>
<summary>Notes on rate limiting</summary>

Limits are applied per provider key, not per tenant, because that is where the
upstream actually counts them.

</details>
`,

  "atlas-labs/prompt-bench": `# prompt-bench

A benchmark harness for MCP prompts, with reproducible scoring.

Every run records the dataset version and the scoring config beside the score,
so a result nobody can reproduce is visibly not a result.

## Install

\`\`\`bash
pip install prompt-bench
prompt-bench run ./suite.toml --out runs/
\`\`\`

## What a run records

- the prompt file, hashed
- the dataset version
- the scorer version
- per-case outcomes

## Reproducing a run

\`\`\`bash
prompt-bench verify runs/2026-02-11.json
\`\`\`

Anything missing from that record is not part of the score.
`,

  "northwind/vector-bridge": `# vector-bridge

Keeps an embedded vector index in sync with an MCP server's tool definitions.

The index is derived data: it is rebuilt from the tool definitions, never
edited, and a stale entry is worse than a missing one because a query will
happily return it.

## Supported stores

| Store | Mode | Rebuild on schema change |
| --- | --- | --- |
| LanceDB | embedded | automatic |
| sqlite-vec | embedded | explicit |
| pgvector | external | automatic |

\`\`\`python
from vector_bridge import sync

sync("mcp://localhost:9000", target="lancedb://./index")
\`\`\`
`,

  "northwind/schema-keeper": `# schema-keeper

Versioned migrations for tool schemas, with a dry-run planner.

A tool schema is an interface other people's agents are coded against. Changing
it is an API change, so the planner prints what breaks before anything moves.

\`\`\`bash
schema-keeper plan ./migrations/0042-add-page-cursor.json
\`\`\`

## Exit codes

- \`0\` — nothing destructive
- \`1\` — destructive change, plan available
- \`2\` — plan is invalid, refusing to continue
`,

  "northwind/snapshot-store": `# snapshot-store

Content-addressed snapshots for tool responses, with a GC sweeper.

Every write is keyed on the hash of the response body, so storing the same
response twice costs one blob and a replay is byte-identical to what the caller
originally saw.

## Layout

\`\`\`
blobs/<aa>/<hash>      the body
index/<key>            key -> hash, with the time it was written
\`\`\`

## Sweeping

The sweeper is a separate command on purpose: deleting a blob is the one
irreversible thing this project does, and it should never happen because a cron
entry collided with someone reading.

\`\`\`bash
snapshot-store sweep --older-than 720h --dry-run
\`\`\`
`,

  "harborlight/ops-console": `# ops-console

An operations console for a fleet of MCP servers.

One screen for what is up, what is slow, and who is affected. It reads the same
trace spans as [trace-viewer](https://github.com/harborlight/trace-viewer) and
the same alerts as [alert-router](https://github.com/harborlight/alert-router).

## Running it

\`\`\`bash
ops-console serve --fleet fleets/prod.yaml
\`\`\`

## What counts as unhealthy

1. The health check failing
2. p99 latency over the fleet's own baseline
3. No successful call in the last window

Third one catches the failure the first two miss: a server that answers
\`200\` with nothing useful in it.
`,

  "harborlight/trace-viewer": `# trace-viewer

Reads MCP trace spans and renders them as a call waterfall.

Span attributes are shown raw rather than prettified. A waterfall that hides the
attribute that explains the slow span is a screenshot, not a tool.

\`\`\`bash
trace-viewer ./spans/2026-02-11.ndjson
\`\`\`

## Supported attributes

- \`mcp.method\`
- \`mcp.tool.name\`
- \`mcp.duration_ms\`
- \`mcp.error.kind\`

## Note on clock skew

Spans from different processes are aligned on their own timestamps, not on the
collector, so a skewed client shows up as a visible offset rather than a
plausible-looking ordering.
`,

  "harborlight/alert-router": `# alert-router

Routes MCP server alerts to on-call rotations, with dedup windows.

## Why dedup windows

One flapping tool produced 40 alerts a minute and woke the whole rotation. The
window is per \`(server, tool, kind)\`, not per server, so one noisy tool stops
hiding a real outage somewhere else.

| Field | Default | Meaning |
| --- | --- | --- |
| \`window\` | 5m | Suppress repeats inside it. |
| \`silence\` | 30m | Suppress everything for a tenant. |
| \`escalateAfter\` | 15m | Page the next person in the rotation. |

\`\`\`bash
alert-router test ./alerts.yaml --at 2026-02-11T09:00:00Z
\`\`\`
`,

  "kestrelworks/skill-forge": `# skill-forge

Scaffolds MCP skill packages with a validated manifest.

\`\`\`bash
npx create-skill my-skill
skill-forge validate ./my-skill
\`\`\`

## What validate checks

1. The manifest parses
2. Every declared file exists
3. The version is semver and matches the tag
4. No absolute paths

## Install

Skills install with \`skill-forge add <name>@<version>\`; a floating version
resolves to the latest and is refused in CI.
`,

  "kestrelworks/agent-personas": `# agent-personas

Reusable personas for agent frameworks, packaged as skills.

A persona is a prompt prefix plus a tool allowlist. Both are meant to be read
before they are used — a persona that hides its own allowlist is a prompt
injection waiting to happen.

## Installing

\`\`\`bash
skill-forge add personas/careful-reviewer@1.2.0
\`\`\`

## Writing one

- keep the prefix under 400 words
- list every tool the persona needs
- say what it refuses to do

That last line is the one people leave out, and it is the one that matters.
`,

  "quiet-harbor/tool-notes": `# tool-notes

A notebook for comparing MCP tool descriptions before shipping them.

Two descriptions that differ by one word can differ by twenty points of call
success. This is where you notice, before the deploy.

| Change | Calls before | Calls after |
| --- | --- | --- |
| "returns a list" | 41% | 44% |
| "returns all items, paginated" | 41% | 79% |

The second row is the whole argument for writing this down.
`,

  "quiet-harbor/cache-sentry": `# cache-sentry

Caches tool responses with per-tenant budgets and eviction alerts.

The budget is the feature. A shared cache without one is a way for the loudest
tenant to become everyone's latency.

## Config

\`\`\`yaml
tenants:
  acme:
    budget: 512mb
    ttl: 15m
  default:
    budget: 64mb
    ttl: 5m
\`\`\`

Eviction above a tenant's budget evicts that tenant's oldest entries first and
raises an alert, rather than reaching into another tenant's share.
`,
}

/**
 * Fails the seed rather than the demo when the two lists disagree.
 *
 * A repository with no entry in {@link DEMO_READMES} would seed fine and render
 * as a detail page whose only document says the README has not been fetched yet,
 * which reads as a bug in the renderer rather than as a missing line of seed
 * data. Throwing at import time puts the message where the omission is.
 */
const REPOS_WITHOUT_README = DEMO_REPOS.filter(
  (spec) => !DEMO_READMES[`${spec.owner}/${spec.name}`]
).map((spec) => `${spec.owner}/${spec.name}`)

if (REPOS_WITHOUT_README.length > 0) {
  throw new Error(
    `DEMO_READMES has no entry for: ${REPOS_WITHOUT_README.join(", ")}`
  )
}

/** What one day did to one counter: where it closed, and how far it moved. */
interface CounterMove {
  level: number
  delta: number
}

/**
 * Every counter's day, plus the star series the demo is really about.
 *
 * `counters` holds all nine, so the tooltip on the detail chart has a level and
 * a change for each rather than eight em dashes. `stars` stays separate because
 * it is the series the whole dataset is keyed on and the only one the rankings
 * read.
 */
interface Day {
  period: Date
  stars: number
  gained: number
  counters: Record<LevelCounterName, CounterMove>
}

/** A coarse period closed off from the days that fell inside it. */
interface Bucket {
  period: Date
  stars: number
  gained: number
  counters: Record<LevelCounterName, CounterMove>
}

/**
 * The daily series one repository follows.
 *
 * The weekly gain decays by `retention` as the history runs, so a repository
 * that peaked early flattens while one with a high retention keeps climbing, and
 * the two ranking lists disagree the way they do with real data. The wobble is a
 * fixed function of the day index rather than a random draw, so the chart is
 * reproducible.
 *
 * Gains are never negative: a negative delta is dropped by the ranking instead
 * of ranked, so a demo set that produced one would not exercise that path.
 */
function dailySeries(spec: DemoRepo, index: number, days: Date[]): Day[] {
  const out: Day[] = []
  let stars = spec.baseStars

  // Each counter moves a share of the day's stars, and the shares are what make
  // the demo legible: forks and watchers track popularity, commits track how
  // much work the repository actually sees, and an open-issue count that only
  // ever rose would misdescribe every project here.
  const arrivals = starArrivals(spec, days.length)
  const series = counterSeries(arrivals, closingLevels(index), index)

  days.forEach((period, day) => {
    const gained = arrivals[day]!
    stars += gained

    // Stars are read off the series itself: a tooltip that disagreed with the
    // chart above it about how many stars the project gained would be worse
    // than no tooltip.
    const counters = emptyMoves()
    counters.stars = { level: stars, delta: gained }
    for (const counter of PROFILED_COUNTERS) {
      counters[counter] = {
        level: series[counter].levels[day]!,
        delta: series[counter].daily[day]!,
      }
    }

    out.push({ period, stars, gained, counters })
  })

  return out
}

/**
 * The star arrivals each day of the history holds.
 *
 * The gain decays by the repository's `retention` as the history runs, so one
 * that peaked early flattens while one with a high retention keeps climbing, and
 * the two ranking lists disagree the way they do with real data. Arrivals are
 * never negative: the ranking drops a period whose delta is negative rather
 * than ranking it, so a demo set that produced one would not exercise that path.
 *
 * The wobble is a fixed function of the day index rather than a random draw, so
 * re-running the seed produces the same rows.
 */
function starArrivals(spec: DemoRepo, days: number): number[] {
  const gainPerDay = spec.weeklyGain / 7

  return Array.from({ length: days }, (_, day) => {
    const progress = day / Math.max(1, days - 1)
    const decay = Math.pow(spec.retention, progress * 4)
    const wobble = 1 + 0.18 * Math.sin(day / 2.7)
    return Math.max(1, Math.round(gainPerDay * decay * wobble))
  })
}

/**
 * Where every counter sits on each day of the history, and how far it moved to
 * get there.
 *
 * A growing counter is stretched so the history opens at {@link OPENING_SHARE} of
 * the level the repository row records and closes at all of it. That is what
 * keeps the `repos` row and the last period of the history from publishing two
 * different current numbers for the same moment; scaling the daily shape does it
 * without flattening the wobble into a straight line.
 *
 * A counter that can fall is centred on its target instead, oscillating above and
 * below it. Scaling a signed series to a net target would divide by a sum near
 * zero, and an open-issue count that climbed to its target rather than hovering
 * around it would say the project fixes everything it is handed.
 */
function counterSeries(
  arrivals: number[],
  closing: Record<ProfiledCounterName, number>,
  index: number
): Record<ProfiledCounterName, { levels: number[]; daily: number[] }> {
  const series = {} as Record<
    ProfiledCounterName,
    { levels: number[]; daily: number[] }
  >

  for (const counter of PROFILED_COUNTERS) {
    const shape = counterShape(counter, arrivals, index)
    const target = closing[counter]

    if (COUNTER_PROFILES[counter].floor) {
      // Oscillating on a few-day period rather than across the whole history: an
      // open-issue count that moved once every hundred days would read as a
      // project nobody files issues against, which is a claim about the project
      // rather than about the shape of the demo.
      const amplitude = Math.max(1, Math.round(target * 0.35))
      const levels = shape.map((_, day) =>
        Math.max(
          0,
          target +
            Math.round(
              amplitude * Math.sin(((day + 1) / ISSUE_CYCLE_DAYS) * Math.PI * 2)
            )
        )
      )
      series[counter] = { levels, daily: differences(levels) }
      continue
    }

    const opening = Math.round(target * OPENING_SHARE)
    const rawTotal = shape.reduce((sum, value) => sum + value, 0)
    const factor = rawTotal > 0 ? (target - opening) / rawTotal : 0

    // The running level is rounded, not the day's movement. Rounding movements
    // independently lets four hundred days of fractions accumulate into a history
    // that closes at a level other than the one the `repos` row records, and
    // correcting it at the end dumps the whole shortfall onto the last day —
    // inside the window the daily chart reads, and a day then shows a watcher
    // count jumping by more than in the fortnight before it. Rounding the running
    // level spreads those fractions across the history instead.
    let running = opening
    const levels = shape.map((value) => {
      running += value * factor
      return Math.round(running)
    })
    // Whatever fraction the running total rounded away belongs to the final
    // level, which the `repos` row and the closing period both read.
    levels[levels.length - 1] = target

    series[counter] = { levels, daily: differences(levels, opening) }
  }

  return series
}

/**
 * One counter's raw daily movement, before it is scaled to the level it closes
 * at.
 *
 * Deliberately unrounded: the scale factor is derived from this series' sum, so
 * rounding here would decide that factor off an integer total, and a counter
 * whose span is a few units across four hundred days would round to zero movement
 * on every day and to zero again after scaling. The sign is clipped rather than
 * rounded for a counter that cannot fall, because a fork count that fell would
 * describe something other than forks.
 */
function counterShape(
  counter: ProfiledCounterName,
  arrivals: number[],
  index: number
): number[] {
  const profile = COUNTER_PROFILES[counter]

  return arrivals.map((gained, day) => {
    const base = profile.rate * gained
    const wobbled =
      base *
      (1 +
        profile.wobble * Math.sin((day + index * 3) / (2.1 + counter.length)))
    return profile.floor ? wobbled : Math.max(0, wobbled)
  })
}

/**
 * What changed between each pair of levels, with the first day's movement measured
 * against the level before the history opened.
 */
function differences(levels: number[], opening = levels[0] ?? 0): number[] {
  return levels.map(
    (level, day) => level - (day === 0 ? opening : levels[day - 1]!)
  )
}

/** Every counter's move at zero, for a period to accumulate into. */
function emptyMoves(): Record<LevelCounterName, CounterMove> {
  const moves = {} as Record<LevelCounterName, CounterMove>
  for (const counter of LEVEL_COUNTERS) moves[counter] = { level: 0, delta: 0 }
  return moves
}

/**
 * How each counter moves relative to the day's stars.
 *
 * `rate` is the share of a day's arrivals the counter also gains, and `wobble`
 * how much its own curve deviates from that share — a repository's commit count
 * does not track its star count as tightly as its fork count does. `floor` marks
 * a counter that can fall: only open issues, where a count that never dropped
 * would misrepresent every project in the demo.
 */
const COUNTER_PROFILES: Record<
  ProfiledCounterName,
  { rate: number; wobble: number; floor?: boolean }
> = {
  watchers: { rate: 0.12, wobble: 0.45 },
  forks: { rate: 0.14, wobble: 0.3 },
  // A wobble wider than the rate, so the curve crosses zero and the issue count
  // genuinely falls some days rather than only ever rising.
  openIssues: { rate: 0.06, wobble: 1.4, floor: true },
  pullRequests: { rate: 0.11, wobble: 0.35 },
  releases: { rate: 0.02, wobble: 0.5 },
  contributors: { rate: 0.015, wobble: 0.4 },
  commits: { rate: 1.9, wobble: 0.45 },
  downloads: { rate: 2.6, wobble: 0.2 },
}

/** The profiled counters, named once so the loops cannot disagree. */
const PROFILED_COUNTERS = Object.keys(COUNTER_PROFILES) as ProfiledCounterName[]

/**
 * The level each counter closes the history at, per repository.
 *
 * Derived from the index rather than authored per repository, so the demo
 * projects differ in every counter without a set of numbers per project to keep
 * consistent with each other. The same values seed the `repos` row, so the
 * current level on a detail page and the closing level of the last period's
 * history agree.
 */
function closingLevels(index: number): Record<ProfiledCounterName, number> {
  return {
    // Stars close wherever the star series closes, so this map deliberately has
    // no entry for them: a second number for the same series would be free to
    // disagree with it. `dailySeries` reads the star level off the series.
    //
    // Sized for four hundred days of history rather than for plausibility alone:
    // a watcher count of forty gains under one watcher a week over that window,
    // so every daily delta rounds to zero and the tooltip shows a level that
    // never moves. Watchers and forks are the two that still read sparsely after
    // scaling, which is roughly what a watcher count looks like in real data.
    watchers: 180 + index * 45,
    forks: 420 + index * 90,
    openIssues: 30 + index * 7,
    pullRequests: 260 + index * 55,
    releases: 48 + index * 11,
    contributors: 90 + index * 20,
    commits: 6100 + index * 900,
    downloads: 24000 + index * 5200,
  }
}

/**
 * Closes each period of a cadence off the daily series.
 *
 * The level is the closing day of the period and the change is the sum of that
 * period's arrivals, so a coarse row and the daily rows under it always agree:
 * this month's level is last month's level plus this month's change, which is
 * the arithmetic the ranking relies on when it reports relative growth.
 */
function bucketsFrom(days: Day[], cadence: StatsCadence): Bucket[] {
  const buckets: Bucket[] = []
  let current: Bucket | undefined

  for (const day of days) {
    const period = periodStart(
      cadence,
      civilOfPeriod(day.period),
      "Asia/Shanghai"
    )
    if (!current || current.period.getTime() !== period.getTime()) {
      // The period opens at the level its first day started from, which is that
      // day's close less that day's movement. Any other opening would make the
      // period's change disagree with the daily rows under it, which is the one
      // thing a coarse row exists to be consistent with.
      const opening = emptyMoves()
      for (const counter of LEVEL_COUNTERS) {
        opening[counter] = {
          level: Math.max(
            0,
            day.counters[counter].level - day.counters[counter].delta
          ),
          delta: 0,
        }
      }
      current = {
        period,
        stars: day.stars - day.gained,
        gained: 0,
        counters: opening,
      }
      buckets.push(current)
    }
    current.gained += day.gained
    current.stars = day.stars
    for (const counter of LEVEL_COUNTERS) {
      current.counters[counter].delta += day.counters[counter].delta
      current.counters[counter].level = day.counters[counter].level
    }
  }

  return buckets
}

/** The Beijing calendar date a period instant falls on. */
function civilOfPeriod(instant: Date): {
  year: number
  month: number
  day: number
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(instant)

  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)

  return { year: read("year"), month: read("month"), day: read("day") }
}

/** One period's closing levels, as the writers take them. */
function levelsOf(period: Bucket): Record<string, number> {
  const levels: Record<string, number> = { stars: period.stars }
  for (const counter of PROFILED_COUNTERS) {
    levels[counter] = period.counters[counter].level
  }
  return levels
}

/**
 * One period's movements, plus the star arrivals.
 *
 * `newStars` is the arrivals and is not one of the nine levels, so it is added
 * here rather than in `COUNTER_PROFILES`: the bar height is the whole point of
 * the demo, and it is the one counter with no level of its own.
 */
function changesOf(period: Bucket): Record<string, number> {
  const changes: Record<string, number> = {
    stars: period.gained,
    newStars: period.gained,
  }
  for (const counter of PROFILED_COUNTERS) {
    changes[counter] = period.counters[counter].delta
  }
  return changes
}

async function main() {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error("CONSOLE_DATABASE_URL is required to run the seed script")
  }

  const { db, pool } = await import("./client")
  const { repoMonthlyStats, repoWeeklyStats } = await import("./schema")
  const { createProject, getProjectBySlug, slugify, updateProject } =
    await import("../lib/github/service/project")
  const { setReadme, upsertRepo } = await import("../lib/github/service/repo")
  const { setProjectTags, upsertTag } =
    await import("../lib/github/service/tag")
  const { upsertAuthor } = await import("../lib/github/service/hall-of-fame")
  const { upsertStatsRows } = await import("../lib/github/service/stats")
  const { periodFromMonth, periodFromWeek } =
    await import("../lib/github/snapshot-dates")
  const { zonedCivilDate } = await import("../lib/time")
  const { lastCompletePeriod } = await import("../lib/github/snapshot-dates")

  const now = new Date()
  const today = zonedCivilDate(now)

  /** Every day of the trailing window, oldest first, at its period instant. */
  const dayPeriods: Date[] = []
  for (let back = HISTORY_DAYS - 1; back >= 0; back -= 1) {
    const civil = new Date(today.getTime() - back * 24 * 60 * 60 * 1000)
    dayPeriods.push(
      periodStart("day", {
        year: civil.getUTCFullYear(),
        month: civil.getUTCMonth() + 1,
        day: civil.getUTCDate(),
      })
    )
  }

  for (const tag of DEMO_TAGS) {
    await upsertTag(db, { ...tag })
  }

  for (const [username, author] of Object.entries(DEMO_AUTHORS)) {
    await upsertAuthor(db, { username, verified: author.verified }, author)
  }

  const repoIds: string[] = []

  for (const [index, spec] of DEMO_REPOS.entries()) {
    const fullName = `${spec.owner}/${spec.name}`
    const days = dailySeries(spec, index, dayPeriods)
    const closing = { ...closingLevels(index), stars: days.at(-1)!.stars }
    const weeks = bucketsFrom(days, "week").slice(-WEEKLY_WEEKS)
    const months = bucketsFrom(days, "month").slice(-MONTHLY_MONTHS)
    const pushedAt = new Date(now.getTime() - (index + 1) * 36 * 60 * 60 * 1000)

    const info: RepoInfo = {
      name: spec.name,
      fullName,
      owner: spec.owner,
      ownerId: spec.ownerId,
      description: spec.description,
      homepage: "",
      createdAt: new Date("2025-03-12T00:00:00Z"),
      pushedAt,
      defaultBranch: "main",
      // The repository row carries the current level, and it is what the
      // category list and the detail header read their counts from. Every
      // non-star count is the level the seeded history closes at, so a reader
      // comparing this row against the last period's tooltip row is comparing
      // two readings of the same moment rather than two invented numbers.
      stars: closing.stars,
      topics: spec.tags,
      archived: false,
      commitCount: closing.commits,
      lastCommit: pushedAt,
      mentionableUsersCount: closing.contributors,
      watchersCount: closing.watchers,
      licenseSpdxId: spec.license,
      pullRequestsCount: closing.pullRequests,
      openIssuesCount: closing.openIssues,
      releasesCount: closing.releases,
      languages: [spec.language],
      forks: closing.forks,
      openGraphImageUrl: "",
      usesCustomOpenGraphImage: false,
      latestReleaseName: `v1.${index}.0`,
      latestReleaseTagName: `v1.${index}.0`,
      latestReleasePublishedAt: pushedAt,
      latestReleaseUrl: `https://github.com/${fullName}/releases`,
      latestReleaseDescription: "",
    }

    const repo = await upsertRepo(db, info)
    repoIds.push(repo.id)

    // Written through `setReadme` rather than through `RepoInfo`, which has no
    // readme field on purpose: the readme and its translation arrive from their
    // own tasks, so a stats refresh can never wipe them. The seed stands in for
    // that task, and going through the same writer means re-running it corrects
    // the stored document instead of leaving an edited one behind.
    const readme = DEMO_READMES[fullName]
    if (readme) await setReadme(db, repo.id, readme)

    // `projects.name` is the repository's name rather than a display name: the
    // public pages address a project as `/projects/<owner>/<name>`, the ranking
    // list links there from `repos.owner/repos.name`, and the category list
    // links there from `projects.owner/projects.name`. A prettier name here would
    // make the ranking's own link a 404.
    const slug = slugify(`${spec.owner}-${spec.name}`)
    const existingProject = await getProjectBySlug(db, slug)
    const project =
      existingProject ??
      (await createProject(db, {
        repoId: repo.id,
        name: spec.name,
        owner: spec.owner,
        slug,
        description: spec.projectDescription,
        url: `https://github.com/${fullName}`,
        status: "active",
        type: spec.type,
      }))

    // Re-running corrects a project rather than leaving the older naming behind.
    if (
      existingProject &&
      (existingProject.name !== spec.name ||
        existingProject.description !== spec.projectDescription)
    ) {
      await updateProject(db, existingProject.id, {
        name: spec.name,
        description: spec.projectDescription,
      })
    }

    await setProjectTags(db, project.id, spec.tags)

    await upsertStatsRows(
      db,
      repo.id,
      days.map((day) => ({
        period: day.period,
        values: {
          levels: levelsOf(day),
          changes: changesOf(day),
        },
      })),
      "day"
    )
    await upsertStatsRows(
      db,
      repo.id,
      weeks.map((week) => ({
        period: week.period,
        values: {
          levels: levelsOf(week),
          changes: changesOf(week),
        },
      })),
      "week"
    )
    await upsertStatsRows(
      db,
      repo.id,
      months.map((month) => ({
        period: month.period,
        values: {
          levels: levelsOf(month),
          changes: changesOf(month),
        },
      })),
      "month"
    )

    console.log(
      `${fullName.padEnd(28)} ${String(days.at(-1)!.stars).padStart(6)} stars  ` +
        `${weeks.length}w / ${months.length}m rows`
    )
  }

  const lastWeek = lastCompletePeriod("week", now)
  const lastMonth = lastCompletePeriod("month", now)

  const [weekCount] = await db
    .select({ total: count() })
    .from(repoWeeklyStats)
    .where(
      and(
        eq(repoWeeklyStats.period, periodFromWeek(lastWeek)),
        inArray(repoWeeklyStats.repoId, repoIds)
      )
    )

  const [monthCount] = await db
    .select({ total: count() })
    .from(repoMonthlyStats)
    .where(
      and(
        eq(repoMonthlyStats.period, periodFromMonth(lastMonth)),
        inArray(repoMonthlyStats.repoId, repoIds)
      )
    )

  console.log(
    `\nrows for the last complete period: ${weekCount?.total ?? 0} weekly ` +
      `(${lastWeek.year}-W${lastWeek.week}), ${monthCount?.total ?? 0} monthly ` +
      `(${lastMonth.year}-${String(lastMonth.month).padStart(2, "0")})`
  )
  console.log("\nsee the data at:")
  console.log("  /rankings")
  console.log("  /rankings?range=month")
  console.log("  /categories")
  console.log(`  /categories/${DEMO_TAGS[1]!.code}`)
  console.log(`  /projects/${DEMO_REPOS[0]!.owner}/${DEMO_REPOS[0]!.name}`)

  await pool.end()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
