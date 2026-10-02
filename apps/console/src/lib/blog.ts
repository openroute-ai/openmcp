import fs from "node:fs"
import path from "node:path"

import matter from "gray-matter"

/**
 * 博客：读 `content/blog/*.md`，frontmatter + 正文。
 *
 * 不用数据库、也不用 CMS——这是这个站点唯一的内容形态，而它需要的编辑能力就是「在仓库
 * 里放一个 markdown 文件」。放进数据库反而要多一处写入路径和一处失败模式。
 *
 * 目录相对 `process.cwd()` 解析：容器里应用的工作目录是 `apps/console`，所以
 * `content/blog` 与 `apps/console/content/blog` 是同一个目录。这一条写在这里是因为
 * 从仓库根目录跑脚本时它会找不到内容，而那种报错看起来像「博客空了」。
 */

const BLOG_DIR = path.join(process.cwd(), "content", "blog")

/** 允许出现在文件名里的字符，也是 URL 里 slug 的形状。 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface BlogPost {
  /** URL 的一段，也是文件名（不含扩展名）。 */
  slug: string
  title: string
  /** ISO 日期，取自 frontmatter 的 `date`。 */
  date: string
  tags: string[]
  /** 列表页用的一行摘要；frontmatter 没写时取正文第一段。 */
  excerpt: string
  /** 未解析的 markdown 正文。 */
  body: string
}

/**
 * 全部文章，新的在前。
 *
 * 按日期倒序，同一天按 slug 排序——不给同一天的两篇文章一个隐式的先后顺序，因为那个
 * 顺序会依赖文件系统返回的顺序，而它在不同机器上不一样。
 */
export function listPosts(): BlogPost[] {
  let filenames: string[]
  try {
    filenames = fs.readdirSync(BLOG_DIR)
  } catch {
    // 目录不存在等于没有文章，不是一个错误：博客还没开张是正常状态，
    // 列表页有自己的空态。
    return []
  }

  return filenames
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      const post = readPost(name)
      return post ? [post] : []
    })
    .sort((a, b) =>
      a.date === b.date
        ? a.slug.localeCompare(b.slug)
        : b.date.localeCompare(a.date)
    )
}

/** 一篇文章；`slug` 不在目录里、或不是合法 slug 时返回 null。 */
export function getPost(slug: string): BlogPost | null {
  if (!SLUG_PATTERN.test(slug)) return null
  return readPost(`${slug}.md`)
}

/**
 * 读一个 markdown 文件。
 *
 * 文件名不是合法 slug 就跳过而不是照读：slug 会进 URL 和静态参数，一个带 `..` 或
 * 大写的文件名在这里就该被挡住，而不是变成一个只在特定部署下才会暴露的路径问题。
 * frontmatter 缺 `title` 或 `date` 同样跳过——一篇没有标题或没有日期的文章没法在列表里
 * 排序，渲染出来也比不渲染更糟。
 */
function readPost(filename: string): BlogPost | null {
  const slug = filename.replace(/\.md$/, "")
  if (!SLUG_PATTERN.test(slug)) return null

  const file = path.join(BLOG_DIR, filename)
  if (!path.dirname(path.resolve(file)).startsWith(path.resolve(BLOG_DIR))) {
    return null
  }

  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    return null
  }

  const { data, content } = matter(raw)
  const title = typeof data.title === "string" ? data.title.trim() : ""
  const date = typeof data.date === "string" ? data.date.trim() : ""
  if (!title || !date) return null

  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === "string")
    : []

  const excerpt =
    typeof data.excerpt === "string" && data.excerpt.trim()
      ? data.excerpt.trim()
      : firstParagraph(content)

  return { slug, title, date, tags, excerpt, body: content }
}

/**
 * 正文的第一个自然段，当作摘要用。
 *
 * 跳过标题行：一篇文章的摘要如果就是它的第一个标题，列表页上会出现两行一模一样的字。
 */
function firstParagraph(markdown: string): string {
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block.trim()
    if (!text || text.startsWith("#")) continue
    return text.replace(/^>+\s*/, "").slice(0, 160)
  }
  return ""
}
