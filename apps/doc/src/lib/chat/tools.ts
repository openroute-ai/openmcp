import "server-only"

import { getSource, type Page } from "@/lib/source"

export type PageMeta = {
  slug: string
  href: string
  locale: string
  title: string
  excerpt: string
}

export type GrepMatch = {
  slug: string
  href: string
  title: string
  line: number
  snippet: string
}

export type ReadPageResult = {
  found: boolean
  href?: string
  title?: string
  content?: string
  truncated?: boolean
}

export function normalizeLocale(locale?: string | null): "zh" | "en" {
  return locale === "en" ? "en" : "zh"
}

function toMeta(page: Page): PageMeta {
  return {
    slug: page.slugs.join("/"),
    href: page.url,
    locale: page.locale ?? "zh",
    title: page.data.title,
    excerpt: page.data.description ?? "",
  }
}

/** 列出某语言下全部文档页的元数据。 */
export async function listPages(locale: "zh" | "en"): Promise<PageMeta[]> {
  const source = await getSource()
  return source.getPages(locale).map(toMeta)
}

/** 防御性正则：将用户输入转为字面量安全的 RegExp。 */
export function buildSafeRegex(pattern: string, flags = "iu"): RegExp | null {
  if (!pattern.trim() || pattern.length > 200) return null
  try {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags)
  } catch {
    return null
  }
}

/** 按关键词检索页面正文，返回命中行、标题与该页 href。 */
export async function grepContent(options: {
  pattern: string
  locale: "zh" | "en"
  maxMatches?: number
}): Promise<GrepMatch[]> {
  const { pattern, locale, maxMatches = 20 } = options
  const re = buildSafeRegex(pattern)
  if (!re) return []

  const source = await getSource()
  const matches: GrepMatch[] = []
  const seen = new Set<string>()

  for (const page of source.getPages(locale)) {
    if (matches.length >= maxMatches) break
    const title = page.data.title
    const excerpt = page.data.description ?? ""
    const href = page.url
    const slug = page.slugs.join("/")

    const addMatch = (line: number, snippet: string) => {
      const key = `${href}:${line}`
      if (matches.length >= maxMatches || seen.has(key)) return
      seen.add(key)
      matches.push({ slug, href, title, line, snippet })
    }

    if (re.test(title) || re.test(excerpt)) addMatch(0, excerpt || title)

    const lines = (page.data.content ?? "").split("\n")
    let countForPage = 0
    for (let i = 0; i < lines.length && matches.length < maxMatches && countForPage < 5; i++) {
      const line = lines[i]
      if (!line || !re.test(line)) continue
      addMatch(i + 1, line.trim().slice(0, 300))
      countForPage += 1
    }
  }

  return matches
}

const MAX_READ_CHARS = 8000

/** 按 slug 或 href 读取页面全文 markdown（超长截断）。 */
export async function readPage(
  slugOrHref: string,
  locale: "zh" | "en"
): Promise<ReadPageResult> {
  const key = slugOrHref?.trim()
  if (!key || key.length > 300 || key.startsWith(".")) return { found: false }

  const normalized = new Set<string>()
  const striped = key.replace(/^\//, "").replace(/\/$/, "")
  normalized.add(striped)
  if (striped.startsWith("docs/")) normalized.add(striped.slice("docs/".length))
  if (striped.startsWith("en/docs/")) normalized.add(striped.slice("en/docs/".length))
  for (const k of normalized) {
    if (k.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
      return { found: false }
    }
  }

  const source = await getSource()
  const found = source
    .getPages(locale)
    .find(
      (page) =>
        normalized.has(page.slugs.join("/")) ||
        normalized.has(page.url.replace(/^\//, "").replace(/\/$/, ""))
    )
  if (!found) return { found: false }

  const body = found.data.content ?? ""
  const truncated = body.length > MAX_READ_CHARS
  return {
    found: true,
    href: found.url,
    title: found.data.title,
    content: truncated
      ? `${body.slice(0, MAX_READ_CHARS)}\n\n…（内容过长已截断，可结合 grep 定位细节）`
      : body,
    truncated,
  }
}
