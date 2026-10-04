/**
 * JSON-LD construction.
 *
 * Built as data and rendered by one component rather than inlined as `<script>`
 * literals scattered through the pages, because the alternative has two failure
 * modes that are both invisible until a crawler complains. An unescaped `</script>`
 * inside any string a repository description can contain closes the tag early and
 * turns the rest of the document into text; and a hand-written `JSON.stringify`
 * in a template literal drops its own backslashes on the strings it quotes. Both
 * are fixed for good below, which leaves each page declaring only its own facts.
 */

import {
  DOCS_ORIGIN,
  SITE_DESCRIPTION,
  SITE_GITHUB_URL,
  SITE_NAME,
  siteUrl,
} from "@/lib/config/site"

/**
 * A schema.org node.
 *
 * `Record<string, unknown>` rather than one of Next's generated types: the shapes
 * here are assembled from a database column or a locale, and a type that cannot
 * express them would push the escaping below into a cast.
 */
export type JsonLd = Record<string, unknown>

/**
 * `@context` and `@type`, prepended by the renderer.
 *
 * Kept out of the node bodies so a caller cannot forget them, and so a node can
 * be reused inside a `@graph` where `@context` belongs to the graph.
 */
export type JsonLdNode = Omit<JsonLd, "@context">

/**
 * The organisation, with the site as its home page.
 *
 * `sameAs` carries the GitHub repository, which is the one identity assertion
 * this site can make that is independently checkable — an answer engine can
 * corroborate the site against the repository rather than taking its own name
 * for it.
 */
export function organizationNode(): JsonLdNode {
  return {
    "@type": "Organization",
    "@id": `${siteUrl("/")}#organization`,
    name: SITE_NAME,
    url: siteUrl("/"),
    logo: {
      "@type": "ImageObject",
      url: siteUrl("/logo-512.png"),
      width: 512,
      height: 512,
    },
    image: siteUrl("/og.png"),
    description: SITE_DESCRIPTION,
    sameAs: [SITE_GITHUB_URL],
  }
}

/**
 * The site itself, with the search action.
 *
 * `potentialAction` is the part that matters here: it is the only structured
 * data this site can offer about how a reader or an agent is meant to use it,
 * and declaring a search endpoint the app does not implement would be the kind
 * of thing that works until someone clicks it.
 */
export function webSiteNode(name: string, description: string): JsonLdNode {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl("/")}#website`,
    name,
    alternateName: SITE_NAME,
    url: siteUrl("/"),
    description,
    inLanguage: "zh-CN",
    publisher: { "@id": `${siteUrl("/")}#organization` },
  }
}

/**
 * A breadcrumb trail.
 *
 * `position` is 1-based per the spec, so the array is mapped from an index
 * rather than carrying a hand-written counter that drifts when a level is added.
 */
export function breadcrumbNode(
  crumbs: { name: string; path: string }[]
): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: siteUrl(crumb.path),
    })),
  }
}

/**
 * A question and its answer.
 *
 * Answers here are the site's own copy from `lib/faq`, so the structured data
 * cannot claim more than the page says. A `FAQPage` whose markup disagrees with
 * the visible text is the fastest way to lose the rich result, which is a worse
 * outcome than not marking the page up at all.
 */
export function faqPageNode(
  entries: { question: string; answer: string }[]
): JsonLdNode {
  return {
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  }
}

/**
 * A blog post.
 *
 * `headline` is capped at the 110 characters the spec asks for and `dateModified`
 * is deliberately left equal to `datePublished`: the posts are markdown files in
 * the repository, and a post's frontmatter `date` is the only date it carries.
 * Claiming a modification date nobody recorded would make the freshness signal
 * meaningless.
 */
export function articleNode(post: {
  title: string
  description: string
  date: string
  slug: string
}): JsonLdNode {
  return {
    "@type": "BlogPosting",
    "@id": `${siteUrl(`/blog/${post.slug}`)}#article`,
    headline: post.title.slice(0, 110),
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: "zh-CN",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": siteUrl(`/blog/${post.slug}`),
    },
    url: siteUrl(`/blog/${post.slug}`),
    author: { "@id": `${siteUrl("/")}#organization` },
    publisher: { "@id": `${siteUrl("/")}#organization` },
    image: siteUrl("/og.png"),
    keywords: post.title,
  }
}

/**
 * The open API, as a thing a reader can ask a question about.
 *
 * Declared on the API docs page so the API is describable as a dataset rather
 * than only as prose: every endpoint here reads a snapshot this site refreshes
 * on a published schedule, and saying so in structured data is what lets an
 * answer engine answer "how fresh is this data" without fetching every response.
 */
export function apiDocsNode(): JsonLdNode {
  return {
    "@type": "TechArticle",
    "@id": `${siteUrl("/docs")}#api-docs`,
    headline: `${SITE_NAME} 开放 API`,
    description:
      "读取排行与仓库统计、登记仓库与发布项目、订阅推送，含鉴权方式、请求参数与返回字段。",
    inLanguage: "zh-CN",
    url: siteUrl("/docs"),
    isAccessibleForFree: true,
    proficiencyLevel: "Beginner",
    dependencies: `${DOCS_ORIGIN}/docs/api`,
  }
}
