/**
 * The indexable pages, described once.
 *
 * Shared by `app/sitemap.ts` and the `/llms.txt` routes because both are answers
 * to the same question — "what on this site is worth indexing, and what is it
 * about" — and two hand-written lists drift into disagreeing within a release. The
 * `description` in particular has to survive being quoted by an answer engine, so
 * it is written to be quotable rather than as a search-result-length teaser, and
 * it is the same string that goes into `llms.txt`.
 *
 * The list is the public surface and nothing else. It is deliberately not derived
 * from `PublicRoutes`: that one is the proxy's gate, so it changes when access
 * changes, and a page that became reachable should not silently become indexed.
 */

export interface IndexablePage {
  /** Absolute path, no locale prefix. */
  path: string
  title: string
  /** One or two sentences. Also the `llms.txt` bullet. */
  description: string
  priority: number
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly"
}

/**
 * Ordered by how much a reader is helped by the page being near the top, not by
 * how often it changes. `priority` and `changeFrequency` are hints that every
 * consumer treats differently and most ignore; the ordering here is the part
 * with an actual effect, because `llms-full.txt` reads the pages in this order.
 */
export const INDEXABLE_PAGES: IndexablePage[] = [
  {
    path: "/",
    title: "首页",
    description:
      "AI雷达的入口：本周异动的实时预览，以及通往榜单、分类与判定规则的入口。",
    priority: 1,
    changeFrequency: "daily",
  },
  {
    path: "/anomalies",
    title: "异动流",
    description:
      "最近命中判定规则的开源项目：增速断崖、异常加速、维护停滞、推送停滞、许可证变更，按检测时间倒序。这是这个站点的主产品面，不是一个榜单。",
    priority: 0.9,
    changeFrequency: "daily",
  },
  {
    path: "/rankings",
    title: "公开榜单",
    description:
      "本周与本月两个周期的星标增量榜，每期与上一期并列。按绝对增量排序，不给综合评分。",
    priority: 0.9,
    changeFrequency: "weekly",
  },
  {
    path: "/rankings/rising",
    title: "年度飙升榜",
    description: "某一自然年内星标绝对增量最大的项目清单。",
    priority: 0.8,
    changeFrequency: "weekly",
  },
  {
    path: "/categories",
    title: "应用分类",
    description:
      "按标签浏览公开项目，标签是人工策展的、并且确实挂在项目上的那一类。",
    priority: 0.7,
    changeFrequency: "weekly",
  },
  {
    path: "/method",
    title: "判定规则",
    description:
      "每一条异动的判定条件、阈值与证据口径：什么算断崖，什么算停滞，为什么不给综合评分。",
    priority: 0.8,
    changeFrequency: "monthly",
  },
  {
    path: "/guide",
    title: "开源选型指南",
    description:
      "按场景给选型框架：先看什么信号，再看什么，以及哪些信号在什么情况下会骗人。",
    priority: 0.8,
    changeFrequency: "monthly",
  },
  {
    path: "/faq",
    title: "常见问题",
    description: "数据来源、为什么不评分、结论怎么复现、与 SCA 工具的区别等。",
    priority: 0.7,
    changeFrequency: "monthly",
  },
  {
    path: "/docs",
    title: "公开 API 文档",
    description:
      "四个匿名 JSON 端点：周榜、月榜、年度飙升榜、异动流，含请求参数、返回字段与错误码。",
    priority: 0.8,
    changeFrequency: "monthly",
  },
  {
    path: "/blog",
    title: "博客",
    description: "判定方法、数据口径，以及星标回答不了的问题。",
    priority: 0.6,
    changeFrequency: "weekly",
  },
  {
    path: "/about",
    title: "关于我们",
    description: "谁在维护这个站点，以及维护它意味着什么。",
    priority: 0.5,
    changeFrequency: "monthly",
  },
  {
    path: "/contact",
    title: "联系我们",
    description: "提交项目、报告误报与商务联系的入口。",
    priority: 0.4,
    changeFrequency: "yearly",
  },
  {
    path: "/privacy",
    title: "隐私政策",
    description: "收集哪些数据、保存多久、怎么删除。",
    priority: 0.3,
    changeFrequency: "yearly",
  },
  {
    path: "/terms",
    title: "服务条款",
    description: "使用这个站点与它的数据意味着什么。",
    priority: 0.3,
    changeFrequency: "yearly",
  },
  {
    path: "/security",
    title: "安全声明",
    description: "漏洞报告渠道、已披露问题的处理方式。",
    priority: 0.3,
    changeFrequency: "monthly",
  },
  {
    path: "/license",
    title: "开源许可",
    description: "本站代码与数据的许可条款。",
    priority: 0.3,
    changeFrequency: "yearly",
  },
]
