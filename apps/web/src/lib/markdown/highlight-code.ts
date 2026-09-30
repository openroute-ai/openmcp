'use client'

import type { Highlighter } from 'shiki'

const LIGHT_THEME = 'github-light'
const DARK_THEME = 'github-dark'

/** Languages used by install prompts / config previews. */
const LANGS = [
  'text',
  'json',
  'jsonc',
  'bash',
  'yaml',
  'toml',
  'ini',
  'http',
  'diff',
  'js',
  'ts',
  'python',
  'md',
] as const

let highlighterPromise: Promise<Highlighter> | null = null
const cache = new Map<string, string>()

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: [LIGHT_THEME, DARK_THEME], langs: [...LANGS] })
    )
  }
  return highlighterPromise
}

function normalizeLang(lang: string | undefined): string {
  const raw = (lang ?? '').trim().toLowerCase()
  if (!raw) return 'text'
  return (LANGS as readonly string[]).includes(raw) ? raw : 'text'
}

/**
 * Highlight code to HTML with light + dark themes baked in as CSS variables
 * (`--shiki-light` / `--shiki-dark`), so the rendered block follows the site
 * theme without re-highlighting.
 */
export async function highlightCode(code: string, lang?: string): Promise<string> {
  const resolved = normalizeLang(lang)
  const key = `${resolved}:${code}`
  const cached = cache.get(key)
  if (cached) return cached

  const highlighter = await getHighlighter()
  const html = highlighter.codeToHtml(code, {
    lang: resolved,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  })

  cache.set(key, html)
  return html
}
