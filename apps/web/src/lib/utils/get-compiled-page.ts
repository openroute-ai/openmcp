import { createCompiler } from "@fumadocs/mdx-remote"
import type { TOCItemType } from "fumadocs-core/toc"
import type { MDXComponents } from "mdx/types"
import type { FC } from "react"
import { serialize } from "@/lib/docs/serialize"
import { getMDXComponents } from "@/mdx-components"
import { getPage } from "./get-page"
import type { Locale } from "@/i18n/routing"

export type PageMdxContent = FC<{ components?: MDXComponents }>

export interface CompiledPageData {
  title: string
  description: string
  date: string
  body: PageMdxContent
  toc: TOCItemType[]
}

const pageCompiler = createCompiler()

/**
 * Reads an MDX page from `content/pages` and compiles it with the Fumadocs
 * preset, so pages can use Fumadocs components (Callout, Steps, Tabs, ...).
 * Returns the renderable body and a table of contents (depth >= 2).
 *
 * The component table is bound at compile time. `@fumadocs/mdx-remote` only
 * feeds MDX the components handed to `body()` and does not consult a provider
 * on its own, so a tag such as `<Accordion>` in `user-guide.mdx` otherwise
 * resolves to MDX's `_missingMdxReference` stub and throws "Expected component
 * `Accordion` to be defined" at render time. It is still spread before
 * `props.components` inside `body()`, so callers can override individual tags.
 */
export async function getCompiledPage(
  type: string,
  locale: Locale
): Promise<CompiledPageData | undefined> {
  const page = await getPage(type, locale)

  if (!page) {
    return undefined
  }

  try {
    const compiled = await serialize(() =>
      pageCompiler.compile({
        source: page.body,
        components: getMDXComponents(),
      })
    )

    return {
      title: page.title,
      description: page.description,
      date: page.date,
      body: compiled.body,
      toc: compiled.toc.filter((item) => item.depth >= 2),
    }
  } catch (error) {
    console.error(`Error compiling page ${type} for locale ${locale}:`, error)
    return undefined
  }
}
