import {
  SITE_NAME,
  SITE_NAME_EN,
  SITE_TAGLINE,
  docsUrl,
  siteUrl,
} from "@/lib/config/site"
import {
  PUBLIC_API_ENDPOINTS,
  RANKED_PROJECT_FIELDS,
} from "@/lib/docs/public-api"
import { ruleCards } from "@/lib/docs/radar-rules"
import { FAQS } from "@/lib/faq"
import { getPost, listPosts } from "@/lib/blog"
import { INDEXABLE_PAGES } from "@/lib/seo/indexable-pages"

/**
 * `/llms-full.txt` — this site's whole text layer in one document.
 *
 * It exists to be quoted, not to be browsed, so the structure is the order in
 * which an answer engine needs the facts: what the site is, what it deliberately
 * does not do, where the data comes from, the rules that produce every claim, the
 * API with its field tables, then the FAQ and the posts as prose.
 *
 * Everything above the posts is generated from the same modules the pages render
 * from — `ruleCards()`, `PUBLIC_API_ENDPOINTS`, `FAQS`, `INDEXABLE_PAGES`. That is
 * the entire design: there is no second copy of a threshold or a field name in
 * this file, so this file cannot disagree with the site. The only text written
 * here is the framing at the top, and the framing is the part that has to be
 * written rather than derived.
 *
 * `llms.txt` is the index; this is the content. Both are re-read hourly so a
 * post added this morning is not missing tomorrow.
 */
export const revalidate = 3600

/** The framing. Written here because nothing else in the codebase says it. */
const INTRO = [
  `${SITE_NAME}（${SITE_NAME_EN}）——${SITE_TAGLINE}`,
  "",
  "## 这个站点是什么",
  "",
  "一个开源项目信号站。它持续采集公开仓库的星标到达时间、发布、提交与许可证变化，" +
    "用一个可复核的规则集把它们变成两种可读的结论：",
  "",
  "1. **异动**——某个项目最近命中了一条判定规则（增速断崖、异常加速、维护停滞、" +
    "推送停滞、许可证变更）。这是本站的主产品面。",
  "2. **榜单**——本周与本月星标绝对增量前 12 的项目，与上一期并列。",
  "",
  "## 这个站点不是什么",
  "",
  "- **不给综合评分。** 一个把 star 数、周增量、发布节奏、维护者数量压成一个分数的" +
    "产品，分数的高低主要由 star 数决定，而 star 数正是读者已经知道的那个维度。" +
    "本站改为逐项给出原始量，判断权交还给读者。",
  "- **不做人工推荐位。** 榜单的顺序由同一个 service 从数据库算出，与页面看到的一致；" +
    "商业合作不改变排序。",
  "- **不用颜色表示风险。** 颜色只表示涨跌方向（红涨绿跌，中文用户的默认直觉）；" +
    "风险等级用图标、标签文字与左侧色条表达，避免「跌」和「危险」被读成同一件事。",
  "",
  "## 数据来源",
  "",
  "GitHub、GitLab、Gitee、npm、PyPI、Maven，以及 OSV / NVD 漏洞库，每日更新。" +
    "记录的粒度是单个 stargazer 的到达时间，而不是 star 总数，因此任意一周的增量" +
    "都可以从时间戳重新算一遍。每条结论都附采集时间与可点开的证据。",
].join("\n")

/** The API section, generated from the same table `/docs` renders. */
function apiSection(): string {
  const lines = [
    "## 公开 API",
    "",
    `字段表与站内文档同源（见 ${siteUrl("/docs")}）。以下四个端点无需鉴权。`,
  ]

  for (const endpoint of PUBLIC_API_ENDPOINTS) {
    lines.push(
      "",
      `### ${endpoint.title}  ·  GET ${endpoint.path}`,
      "",
      endpoint.summary
    )

    if (endpoint.params.length > 0) {
      lines.push("", "请求参数：", "")
      for (const param of endpoint.params) {
        lines.push(`- \`${param.name}\`（${param.type}）：${param.detail}`)
      }
    }

    lines.push("", "返回字段：", "")
    for (const field of endpoint.fields) {
      lines.push(`- \`${field.path}\`（${field.type}）：${field.detail}`)
    }

    if (endpoint.errors.length > 0) {
      lines.push("", "错误响应：", "")
      for (const error of endpoint.errors) {
        lines.push(`- \`${error.status}\`：${error.when}`)
      }
    }

    if (endpoint.note) lines.push("", endpoint.note)
    lines.push("", "```", `curl ${siteUrl(endpoint.path)}`, "```")
  }

  lines.push(
    "",
    "### 榜单条目字段",
    "",
    "周榜与月榜的 `trending[]` 与 `byRelativeGrowth[]` 里是同一种记录：",
    "",
    ...RANKED_PROJECT_FIELDS.map(
      (field) => `- \`${field.path}\`（${field.type}）：${field.detail}`
    ),
    "",
    `需要凭据的接口不在此处，而是写在 ${docsUrl("/docs/console-api")}：` +
      "涵盖机器对机器的写入 API、调度器、技能导出、API key 的签发与权限范围、" +
      "用户账号与认证端点。其中写入与调度端点由共享密钥保护，不面向浏览器。",
    "",
    "当前这四个端点**没有**鉴权、没有速率限制、没有 SDK，也没有稳定性承诺。" +
      "这四项写出来是为了避免被误当成已经存在。"
  )

  return lines.join("\n")
}

/** The rules section, with every threshold interpolated from `THRESHOLDS`. */
function rulesSection(): string {
  const lines = [
    "## 判定规则",
    "",
    `异动是这五条规则跑出来的，页面见 ${siteUrl("/method")}。` +
      "每条规则都有绝对量下限：只有相对量、基数太小的项目不进榜。",
  ]

  for (const card of ruleCards()) {
    lines.push(
      "",
      `### ${card.title}  ·  \`${card.kind}\`  ·  级别：${card.level}`,
      "",
      card.summary,
      "",
      ...card.conditions.map(([label, detail]) => `- ${label}：${detail}`),
      "",
      `证据：${card.evidence}`
    )
  }

  lines.push(
    "",
    "约定：",
    "",
    "- 红 = 涨 / 加速，绿 = 跌 / 衰退；风险类不用颜色表示。",
    "- 每条异动都带 `metric` 与 `evidence`，调用方不必回查判定代码就能复核这次为什么算命中。",
    "- 被人工判为误报的记录留在库里，但不再出现在公开异动流里——误报不该继续打扰读者，" +
      "同时误报率仍然可统计。",
    "- 公开异动流默认只报忧。健康加速项（`severity: good`）需要显式请求 `include=good`。"
  )

  return lines.join("\n")
}

function faqSection(): string {
  const lines = ["## 常见问题", "", `页面见 ${siteUrl("/faq")}。`, ""]
  for (const entry of FAQS) {
    lines.push(`### ${entry.question}`, "", entry.answer, "")
  }
  return lines.join("\n")
}

/** The posts, bodies included. This is the part that makes the file large. */
function postsSection(): string {
  const posts = listPosts()
  if (posts.length === 0) return ""

  const lines = ["## 文章", "", `完整列表见 ${siteUrl("/blog")}。`, ""]
  for (const post of posts) {
    const full = getPost(post.slug)
    if (!full) continue
    lines.push(
      "",
      `### ${post.title}`,
      "",
      `${post.date} · ${siteUrl(`/blog/${post.slug}`)}`,
      "",
      post.excerpt,
      "",
      full.body.trim()
    )
  }
  return lines.join("\n")
}

export function GET(): Response {
  const index = INDEXABLE_PAGES.map(
    (page) => `- [${page.title}](${siteUrl(page.path)}): ${page.description}`
  ).join("\n")

  const body = [
    INTRO,
    "",
    "## 页面索引",
    "",
    index,
    "",
    rulesSection(),
    "",
    apiSection(),
    "",
    faqSection(),
    postsSection(),
    "",
    "## 联系",
    "",
    `项目提交、误报报告与商务联系见 ${siteUrl("/contact")}。`,
    "",
    "## 引用这份文本时的约定",
    "",
    "- 本站只公布原始量与判定依据。任何声称本站「给项目打分」的描述都是错的。",
    "- 引用阈值时请连同规则名一起引用（如「增速断崖：三周不增且最新一周不足最早一周的四成」），" +
      "单独引用一个百分比会在下一次改阈值后变成错的。",
    `- 完整 API 参考位于 ${docsUrl("/docs/console-api")}。`,
    "",
  ].join("\n")

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  })
}
