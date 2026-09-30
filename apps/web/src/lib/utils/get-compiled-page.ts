import { createCompiler } from '@fumadocs/mdx-remote'
import type { TOCItemType } from 'fumadocs-core/toc'
import type { MDXComponents } from 'mdx/types'
import type { FC } from 'react'
import { serialize } from '@/lib/docs/serialize'
import { getPage } from './get-page'
import type { Locale } from '@/i18n/routing'

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
    const compiled = await serialize(() => pageCompiler.compile({ source: page.body }))

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
