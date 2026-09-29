'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface McpDetailContentProps {
  description: string
  tools: Record<string, unknown>[] | null
}

type ToolRecord = { name?: unknown; title?: unknown; description?: unknown }

export function McpDetailContent({ description, tools }: McpDetailContentProps) {
  const t = useTranslations('McpPage.detail')
  const [descriptionOpen, setDescriptionOpen] = useState(true)
  const [toolsOpen, setToolsOpen] = useState(true)

  const toolList: ToolRecord[] = Array.isArray(tools) ? tools : []

  return (
    <>
      <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
        <button
          type='button'
          onClick={() => setDescriptionOpen((v) => !v)}
          className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
          aria-expanded={descriptionOpen}
        >
          <h2 className='font-semibold text-lg'>{t('overview')}</h2>
          {descriptionOpen ? (
            <ChevronUp className='h-5 w-5 text-muted-foreground' />
          ) : (
            <ChevronDown className='h-5 w-5 text-muted-foreground' />
          )}
        </button>
        {descriptionOpen && (
          <div className='border-border border-t p-6 sm:p-10'>
            {description ? (
              <div className='prose dark:prose-invert prose-p:my-4 max-w-none prose-headings:scroll-mt-20 prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-bold prose-a:text-primary prose-code:text-foreground prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-strong:text-foreground prose-p:leading-relaxed prose-a:no-underline prose-code:before:content-none prose-code:after:content-none hover:prose-a:underline'>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // A remote markdown body can reference images; drop empty
                    // sources rather than rendering a broken <img>.
                    img: ({ src, ...props }) => (src ? <img src={src} alt='' {...props} /> : null),
                  }}
                >
                  {description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className='text-muted-foreground'>{t('noDescription')}</p>
            )}
          </div>
        )}
      </section>

      {toolList.length > 0 && (
        <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
          <button
            type='button'
            onClick={() => setToolsOpen((v) => !v)}
            className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
            aria-expanded={toolsOpen}
          >
            <h2 className='font-semibold text-lg'>{t('toolsCount', { count: toolList.length })}</h2>
            {toolsOpen ? (
              <ChevronUp className='h-5 w-5 text-muted-foreground' />
            ) : (
              <ChevronDown className='h-5 w-5 text-muted-foreground' />
            )}
          </button>
          {toolsOpen && (
            <div className='border-border border-t p-6'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                {toolList.map((tool, index) => {
                  const name = String(tool.name ?? tool.title ?? `tool-${index + 1}`)
                  const toolDescription = String(tool.description ?? '')
                  return (
                    <div key={`${name}-${index}`} className='rounded-lg border bg-muted/30 p-4'>
                      <p className='mb-1 font-mono font-medium text-foreground text-sm'>{name}</p>
                      {toolDescription && <p className='text-muted-foreground text-sm'>{toolDescription}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  )
}
