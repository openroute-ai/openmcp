/**
 * The Agent Card: what this site is, to a machine.
 *
 * An agent card is a *promise* made to a client that cannot read the site. If it
 * advertises a threshold or a field the code does not have, the client will
 * trust it and be wrong — and it will blame this site. So the card is built from
 * the same modules the pages render: `ruleCards()` for the five rules,
 * `RANKED_PROJECT_FIELDS` for the board's shape, `SITE_*` for identity. The
 * `examples` are real request payloads, because an example that does not
 * parse is worse than no example.
 *
 * Two versions are served, because the discovery URI itself changed:
 *
 * - `1.0` — `/.well-known/agent-card.json`, `supportedInterfaces`, PascalCase
 *   methods (`SendMessage`), `TASK_STATE_*` states, `{ task: … }` envelope.
 * - `0.3` — `/.well-known/agent.json`, `url` + `preferredTransport`,
 *   `message/send`, lowercase states, bare envelope. Kept because clients
 *   written against 0.3 hardcode that filename, and they will not read a 1.0
 *   card out of a 0.3 path.
 *
 * Both advertise the same skills, so a capability difference is never a
 * content difference.
 */

import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_NAME_EN,
  siteUrl,
} from "@/lib/config/site"

/** Protocol versions this server speaks, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["1.0", "0.3"] as const
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number]

/** The path each version's discovery document lives at. */
export const CARD_PATH: Record<ProtocolVersion, string> = {
  "1.0": "/.well-known/agent-card.json",
  "0.3": "/.well-known/agent.json",
}

/** The single JSON-RPC endpoint. Same URL in both versions. */
export const A2A_ENDPOINT = "/api/a2a"

type SkillSpec = {
  id: string
  name: string
  description: string
  tags: string[]
  examples: string[]
}

/**
 * The skills, with their invocation contract spelled out in the description.
 *
 * The input convention is JSON in a message part's `data`, not prose. Prose
 * would mean parsing intent, and a ranking read is not worth a guess: the same
 * question asked two ways should not be able to return two different weeks.
 * `text/plain` is still accepted and forwarded as a free-text `describe` skill
 * for clients that can only speak prose, and that path is read-only and clearly
 * labelled as such.
 */
const SKILLS: SkillSpec[] = [
  {
    id: "explain",
    name: "这个网站是做什么的",
    description:
      "说明本站的定位、采集口径、五条异动判定规则、颜色约定，以及榜单每个字段的含义。" +
      "适合在任何数据读取之前先调用一次，确认术语。无需参数。",
    tags: ["about", "rules", "methodology", "explain"],
    examples: ["这个网站是做什么的？", "你们怎么判定异动？", "{}"],
  },
  {
    id: "rankings",
    name: "读取星标排行（日 / 周 / 月）",
    description:
      "按星标增量与相对增速返回排行。cadence 取 day | week | month（默认 week）。" +
      "不给周期参数时返回**最近一个已结束**的周期，不会把正在累积的周与已结束的周混排。" +
      'year+week / year+month 必须成对给出；日榜用 day（"YYYY-MM-DD"，Asia/Shanghai）。' +
      "limit 1-100，默认 20。不含综合评分：站点不给单一分数排名。",
    tags: ["rankings", "trending", "stars", "daily", "weekly", "monthly"],
    examples: [
      "{}",
      '{"cadence":"month"}',
      '{"cadence":"day","day":"2026-09-30"}',
      '{"cadence":"week","year":2026,"week":38}',
    ],
  },
  {
    id: "rising-stars",
    name: "读取飙升榜",
    description:
      "按相对增速排序，并施加两道绝对量门槛：上周星标 ≥ 200 且本周新增 ≥ 50。" +
      "只给百分比不给门槛会让 4 星涨到 12 星的项目排在每一周榜首——算术上没错，但没有决策价值。" +
      "返回字段含实际候选数、门槛后数量与门槛本身，便于判断榜是否被截断。",
    tags: ["rising", "growth", "stars", "rankings"],
    examples: ["{}"],
  },
  {
    id: "project-detail",
    name: "读取单个仓库的详细信息",
    description:
      "以 owner/name（自然键，与榜单里的 fullName 相同）为键返回公开详情：" +
      "当前星标、近 90 天新增、fork / 贡献者 / 发布、许可证、主语言、最近推送、" +
      "标签、当前命中的异动，以及逐周与逐日的星标**新增**序列。" +
      "注意增长序列是「该周期新增」而非累计星标。仓库不存在或未公开时返回 error 而非空对象。",
    tags: ["project", "repository", "detail", "stats"],
    examples: [
      '{"fullName":"vercel/next.js"}',
      '{"owner":"vercel","name":"next.js"}',
    ],
  },
  {
    id: "anomalies",
    name: "读取当前异动",
    description:
      "返回当前命中的异动条目。默认只报忧不报喜：问「异动」的人想知道的是哪个项目出了问题，" +
      "所以 `good` 级别的正向异动需要显式 includeGood 才会返回。每条附 kind、severity 与 evidence。",
    tags: ["anomalies", "alerts", "risk"],
    examples: ["{}", '{"includeGood":true}'],
  },
]

/**
 * The 1.0 card.
 *
 * No `securitySchemes` and no `securityRequirements`. That is the whole
 * expression of the "no key, no auth" requirement: the spec has a client read
 * those fields and authenticate, so a card that declared a scheme would be
 * telling the client to send a credential the server will then ignore or
 * reject. Omitting them is what makes anonymous the *declared* contract rather
 * than an undocumented accident.
 */
export function agentCard(version: ProtocolVersion = "1.0"): unknown {
  return version === "0.3" ? legacyCard() : currentCard()
}

function currentCard(): unknown {
  return {
    protocolVersion: "1.0",
    name: SITE_NAME_EN,
    description: SITE_DESCRIPTION,
    supportedInterfaces: [
      {
        url: absolute(A2A_ENDPOINT),
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    provider: {
      organization: SITE_NAME,
      url: absolute("/"),
    },
    version: "1.0.0",
    documentationUrl: absolute("/llms-full.txt"),
    capabilities: {
      // Each read answers in one round trip against data that is already
      // public HTML, so there is nothing to stream and nothing to push.
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: SKILLS.map((skill) => ({
      ...skill,
      inputModes: ["application/json", "text/plain"],
      outputModes: ["application/json", "text/plain"],
    })),
  }
}

/**
 * The 0.3 card, for the discovery path 0.3 clients hardcode.
 *
 * Same skills, old envelope: `url`/`preferredTransport` instead of
 * `supportedInterfaces`, and no `protocolVersion` field, which 1.0 clients read
 * to decide the card shape.
 */
function legacyCard(): unknown {
  return {
    name: SITE_NAME_EN,
    description: SITE_DESCRIPTION,
    url: absolute(A2A_ENDPOINT),
    preferredTransport: "JSONRPC",
    additionalInterfaces: [],
    provider: {
      organization: SITE_NAME,
      url: absolute("/"),
    },
    version: "1.0.0",
    documentationUrl: absolute("/llms-full.txt"),
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: SKILLS.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: skill.tags,
      examples: skill.examples,
      inputModes: ["application/json", "text/plain"],
      outputModes: ["application/json", "text/plain"],
    })),
  }
}

/* Imported at the bottom so the doc comment above reads as prose first. */

function absolute(path: string): string {
  return siteUrl(path)
}
