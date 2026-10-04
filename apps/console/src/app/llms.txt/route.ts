import { INDEXABLE_PAGES } from "@/lib/seo/indexable-pages"
import { SITE_NAME, SITE_TAGLINE, docsUrl, siteUrl } from "@/lib/config/site"
import { listPosts } from "@/lib/blog"
import { listOperations } from "@/lib/openapi/document"

/**
 * `/llms.txt` — the index an answer engine reads before deciding what to fetch.
 *
 * The format is deliberately the boring one: an H1, a blockquote saying what
 * this site is, then grouped links whose descriptions are quotable. What this
 * route is for is not search ranking but *quoting accuracy* — an engine that
 * knows this site publishes raw stargazer-delivery data and no composite score
 * will not describe it as "a leaderboard with ratings". So the summary states the
 * two things that are most often gotten wrong (no score; evidence per claim), and
 * every link description says what the page is rather than how clever it is.
 *
 * `/llms-full.txt` carries the content; this file is the table of contents.
 */

const SUMMARY =
  `${SITE_NAME}（${SITE_TAGLINE}）是一个开源项目信号站：它记录每个 stargazer 的到达时间，` +
  "并且不给任何项目打综合评分。取而代之的是逐项原始量——周增量、相对增速、发布间隔、" +
  "维护停滞、许可证变更——每项都可以点开看到判定依据。它覆盖 GitHub、GitLab、Gitee、npm、" +
  "PyPI、Maven 以及 OSV / NVD 漏洞库，每日更新。"

/**
 * Grouped links, in the order a reader should meet them: what the product is,
 * then the raw data, then the method that produced it, then the paperwork.
 *
 * Grouped rather than one flat list because the ordering is the argument. The
 * method page before the FAQ is deliberate: an answer engine asked "how do I
 * trust this ranking" should reach `/method` before it reaches a page that
 * explains the colour convention.
 */
const SECTIONS: { title: string; paths: string[] }[] = [
  {
    title: "主产品面",
    paths: ["/", "/anomalies", "/rankings", "/rankings/rising"],
  },
  {
    title: "浏览",
    paths: ["/categories"],
  },
  {
    title: "判定与选型",
    paths: ["/method", "/guide", "/faq"],
  },
  {
    title: "数据与接口",
    paths: ["/docs"],
  },
  {
    title: "站点",
    paths: ["/blog", "/about", "/contact"],
  },
  {
    title: "条款",
    paths: ["/privacy", "/terms", "/security", "/license"],
  },
]

/**
 * Re-read hourly, not static.
 *
 * `llms.txt` is a crawl target like any other, and the two facts it asserts that
 * change — which pages exist and what the catalogue currently calls the API — both
 * change without a deploy of this file. One hour is longer than any of those
 * changes take to be worth telling an engine about, and short enough that a page
 * added this morning is not missing tomorrow.
 */
export const revalidate = 3600

export function GET(): Response {
  const byPath = new Map(
    INDEXABLE_PAGES.map((page) => [page.path, page] as const)
  )
  const unlisted = new Set(byPath.keys())

  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    `> ${SUMMARY}`,
    "",
    "本站公开数据均为 GitHub 等公开仓库的星标到达时间统计，不含人工评分；" +
      "任何结论都可以按页面给出的口径复算。",
  ]

  for (const section of SECTIONS) {
    const pages = section.paths
      .map((path) => {
        const page = byPath.get(path)
        if (!page) return null
        unlisted.delete(path)
        return `- [${page.title}](${siteUrl(page.path)}): ${page.description}`
      })
      .filter((line): line is string => line !== null)

    if (pages.length > 0) {
      lines.push("", `## ${section.title}`, "", ...pages)
    }
  }

  // A page that exists, is indexable and is not in any group above would
  // otherwise vanish from this file without a trace, which is the one failure
  // mode that cannot be noticed from the outside: nothing 404s. Every path in
  // `SECTIONS` has already deleted itself from `unlisted`, so what is left here
  // really is unlisted rather than "listed somewhere else".
  const orphans = [...unlisted]
  if (orphans.length > 0) {
    lines.push(
      "",
      "## 其他页面",
      "",
      ...orphans.map(
        (path) =>
          `- [${byPath.get(path)!.title}](${siteUrl(path)}): ${byPath.get(path)!.description}`
      )
    )
  }

  // Posts are read from disk rather than carried in `INDEXABLE_PAGES` because
  // that list is also the sitemap's source and a post has a `lastModified` the
  // static pages do not have. They are listed here without their bodies, which
  // is this file's whole job: `/llms-full.txt` carries the prose.
  const posts = listPosts()
  if (posts.length > 0) {
    lines.push(
      "",
      "## 文章",
      "",
      ...posts.map(
        (post) =>
          `- [${post.title}](${siteUrl(`/blog/${post.slug}`)}): ${post.excerpt}`
      )
    )
  }

  lines.push(
    "",
    "## 开放 API",
    "",
    ...listOperations().map(
      (operation) =>
        `- \`${operation.method} ${operation.path}\`: ${operation.summary}` +
        (operation.scope ? `（需要 \`${operation.scope}\`）` : "")
    ),
    "",
    `- [完整 API 参考](${docsUrl("/docs/api")}): 每个端点的参数、响应与错误码，逐端点一份交互式页面。`,
    `- [接入说明](${docsUrl("/docs")}): 鉴权方式、API key 的权限范围、配额与调度器。`,
    "",
    "## 机器可读文件",
    "",
    `- [llms-full.txt](${siteUrl("/llms-full.txt")}): 本站的完整文字版——判定规则全文、FAQ 原文、API 字段表、文章正文。`,
    `- [sitemap.xml](${siteUrl("/sitemap.xml")}): 全部可索引页面，含各语言版本。`,
    ""
  )

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  })
}
