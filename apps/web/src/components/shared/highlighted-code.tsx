'use client'

import { useEffect, useState } from 'react'
import { highlightCode } from '@/lib/markdown/highlight-code'
import { cn } from '@/lib/utils'

export interface HighlightedCodeProps {
  code: string
  lang?: string
  className?: string
}

/** Code block with shiki syntax highlighting, following the site light/dark theme. */
export function HighlightedCode({ code, lang, className }: HighlightedCodeProps) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setHtml(null)
    highlightCode(code, lang)
      .then((result) => {
        if (alive) setHtml(result)
      })
      .catch(() => {
        if (alive) setHtml(null)
      })
    return () => {
      alive = false
    }
  }, [code, lang])

  return (
    <div
      className={cn(
        'not-fumadocs-codeblock overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground/90 leading-relaxed',
        className
      )}
    >
      {html ? (
        <div className='[&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-0' dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className='whitespace-pre-wrap break-words'>
          <code className='font-mono'>{code}</code>
        </pre>
      )}
    </div>
  )
}
