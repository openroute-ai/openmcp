import "server-only"

import { localMd } from "@fumadocs/local-md"
import * as TablerIcons from "@tabler/icons-react"
import { dynamicLoader } from "fumadocs-core/source/dynamic"
import * as LucideIcons from "lucide-react"
import { createElement, type ElementType, type ReactNode } from "react"
import { i18n } from "./i18n"
import { docsContentRoute, docsImageRoute, localePath } from "./shared"

const content = localMd({
  dir: "content/docs",
  include: [
    "**/*.md",
    "**/*.mdx",
    "**/meta.json",
    "**/meta.*.json",
  ],
})

/** 同时解析内容 frontmatter 使用的 Tabler 图标与 meta 使用的 Lucide 图标。 */
function resolveIcon(name: string | undefined): ReactNode {
  if (!name) return
  const Icon =
    (TablerIcons as unknown as Record<string, ElementType | undefined>)[
      name
    ] ?? (LucideIcons as unknown as Record<string, ElementType | undefined>)[name]
  if (!Icon) return
  return createElement(Icon, {
    className: "size-4",
  })
}

const loader = dynamicLoader(content.dynamicSource(), {
  baseUrl: "/docs",
  i18n,
  icon: resolveIcon,
})

export async function getSource() {
  return loader.get()
}

export type DocsSource = Awaited<ReturnType<typeof getSource>>
export type Page = DocsSource["$inferPage"]

/** 重新扫描内容目录，用于本地开发时新增/修改文件的即时刷新。 */
export async function revalidateSource() {
  content.invalidateFile("content/docs")
  loader.invalidate()
  await loader.revalidate()
}

export function getPageImage(page: Pick<Page, "slugs" | "locale">) {
  const segments = [...page.slugs, "image.webp"]

  return {
    segments,
    url: `${localePath(page.locale, docsImageRoute)}/${segments.join("/")}`,
  }
}

export function getPageMarkdownUrl(page: Pick<Page, "slugs" | "locale">) {
  const segments = [...page.slugs, "content.md"]

  return {
    segments,
    url: `${localePath(page.locale, docsContentRoute)}/${segments.join("/")}`,
  }
}

/** local-md 内容以原始 markdown（`data.content`）作为 LLM 文本来源。 */
export async function getLLMText(page: Page) {
  return `# ${page.data.title} (${localePath(page.locale, page.url)})

${page.data.content}`
}
