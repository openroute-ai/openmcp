'use client'

import type { ReactElement, ReactNode } from 'react'
import { Children, isValidElement } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HighlightedCode } from '@/components/shared/highlighted-code'
import { remarkTrimAutolink } from '@/lib/markdown/remark-trim-autolink'
import { cn } from '@/lib/utils'

export interface PromptMarkdownProps {
  /** Markdown source (install prompts are authored as markdown). */
  content: string
  className?: string
}

function nodeToText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join('')
  if (isValidElement(node)) {
    return nodeToText((node as ReactElement<{ children?: ReactNode }>).props?.children)
  }
  return ''
}

/**
 * Render an install prompt as markdown (GFM) with shiki-highlighted code blocks,
 * so headings / lists / config snippets stay readable while the copy button
 * still ships the raw markdown to the Agent.
 */
export function PromptMarkdown({ content, className }: PromptMarkdownProps) {
  const components: Components = {
    h1: ({ children }) => <h3 className='mb-1.5 font-semibold text-foreground text-sm first:mt-0'>{children}</h3>,
    h2: ({ children }) => <h4 className='mt-3 mb-1.5 font-semibold text-foreground text-xs first:mt-0'>{children}</h4>,
    h3: ({ children }) => <h5 className='mt-2.5 mb-1 font-medium text-foreground text-xs'>{children}</h5>,
    p: ({ children }) => (
      // whitespace-pre-line 保留提示词源码里的换行（markdown 软换行在 HTML 里只留 \n）
      <p className='my-1.5 whitespace-pre-line break-words leading-relaxed first:mt-0 last:mb-0'>{children}</p>
    ),
    ul: ({ children }) => (
      <ul className='my-1.5 list-disc space-y-1 pl-4 marker:text-muted-foreground/70'>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className='my-1.5 list-decimal space-y-1 pl-4 marker:text-muted-foreground/70'>{children}</ol>
    ),
    li: ({ children }) => <li className='pl-0.5 leading-relaxed'>{children}</li>,
    strong: ({ children }) => <strong className='font-semibold text-foreground'>{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className='my-2 border-primary/30 border-l-2 bg-muted/40 px-2.5 py-1.5 text-muted-foreground'>
        {children}
      </blockquote>
    ),
    hr: () => <hr className='my-3 border-border' />,
    table: ({ children }) => (
      <div className='my-2 overflow-x-auto'>
        <table className='w-full border-collapse text-xs'>{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className='border border-border bg-muted/50 px-2 py-1 text-left font-medium'>{children}</th>
    ),
    td: ({ children }) => <td className='border border-border px-2 py-1 align-top'>{children}</td>,
    a: ({ href, children }) => (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='text-primary underline underline-offset-2 hover:opacity-80'
      >
        {children}
      </a>
    ),
    pre: ({ children }) => {
      const child = Children.toArray(children)[0]
      if (!isValidElement(child)) {
        return <pre className='my-2 overflow-x-auto'>{children}</pre>
      }
      const props = (child as ReactElement<{ className?: string; children?: ReactNode }>).props
      const lang = /language-([\w+#-]+)/.exec(props?.className ?? '')?.[1]
      return <HighlightedCode code={nodeToText(props?.children).replace(/\n$/, '')} lang={lang} className='my-2' />
    },
    code: ({ children, className }) => (
      <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground', className)}>
        {children}
      </code>
    ),
  }

  return (
    <div className={cn('text-muted-foreground text-xs', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkTrimAutolink]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
