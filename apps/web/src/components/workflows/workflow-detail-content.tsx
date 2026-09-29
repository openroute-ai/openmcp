'use client'

import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkflowDetailData } from './types'

interface WorkflowDetailContentProps {
  workflow: Pick<WorkflowDetailData, 'description' | 'readme'>
}

export function WorkflowDetailContent({ workflow }: WorkflowDetailContentProps) {
  const t = useTranslations('Workflows')
  const [copied, setCopied] = useState(false)
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(true)
  const [isReadmeExpanded, setIsReadmeExpanded] = useState(true)

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(workflow.readme)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch (err) {
      console.error('Failed to copy markdown:', err)
    }
  }

  return (
    <>
      {/* Description Section */}
      <section className='mb-8 rounded-lg border border-border bg-card shadow-sm'>
        <button
          onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
          className='flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
          aria-expanded={isDescriptionExpanded}
          aria-label={isDescriptionExpanded ? t('detail.collapseDescription') : t('detail.expandDescription')}
        >
          <h2 className='text-lg font-semibold'>{t('detail.description')}</h2>
          {isDescriptionExpanded ? (
            <ChevronUp className='h-5 w-5 text-muted-foreground' />
          ) : (
            <ChevronDown className='h-5 w-5 text-muted-foreground' />
          )}
        </button>
        {isDescriptionExpanded && (
          <div className='border-t border-border p-10'>
            <div className='prose dark:prose-invert prose-p:my-4 max-w-none prose-headings:scroll-mt-20 prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-bold prose-a:text-primary prose-code:text-foreground prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-strong:text-foreground prose-p:leading-relaxed prose-a:no-underline prose-code:before:content-none prose-code:after:content-none hover:prose-a:underline'>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src, ...props }) => {
                    if (!src || src === '') {
                      return null
                    }
                    return <img src={src} {...props} />
                  },
                }}
              >
                {workflow.description}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </section>

      {/* Markdown Content Section */}
      <section className='relative mb-8 overflow-hidden rounded-lg border border-border bg-card shadow-sm'>
        <div
          onClick={() => setIsReadmeExpanded(!isReadmeExpanded)}
          className='flex w-full cursor-pointer items-center justify-between p-4 text-left transition-colors hover:bg-muted/50'
          role='button'
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsReadmeExpanded(!isReadmeExpanded)
            }
          }}
          aria-expanded={isReadmeExpanded}
          aria-label={isReadmeExpanded ? t('detail.collapseMarkdown') : t('detail.expandMarkdown')}
        >
          <h2 className='text-lg font-semibold'>{t('detail.markdown')}</h2>
          <div className='flex items-center gap-2'>
            {isReadmeExpanded && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void handleCopyMarkdown()
                }}
                className='group p-2 text-muted-foreground transition-colors hover:text-primary'
                aria-label='Copy Markdown content to clipboard'
              >
                <span className='sr-only'>Copy Markdown</span>
                {copied ? (
                  <Check className='h-4 w-4 text-green-500' />
                ) : (
                  <div className='relative'>
                    <Copy className='h-4 w-4' />
                    <span className='pointer-events-none absolute top-full right-0 mt-2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-white text-xs opacity-0 transition-opacity group-hover:opacity-100'>
                      {t('detail.copyMarkdown')}
                    </span>
                  </div>
                )}
              </button>
            )}
            {isReadmeExpanded ? (
              <ChevronUp className='h-5 w-5 text-muted-foreground' />
            ) : (
              <ChevronDown className='h-5 w-5 text-muted-foreground' />
            )}
          </div>
        </div>
        {isReadmeExpanded && (
          <div className='border-t border-border p-10'>
            <div className='prose dark:prose-invert prose-p:my-4 max-w-none prose-headings:scroll-mt-20 prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-bold prose-a:text-primary prose-code:text-foreground prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-strong:text-foreground prose-p:leading-relaxed prose-a:no-underline prose-code:before:content-none prose-code:after:content-none hover:prose-a:underline'>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ src, ...props }) => {
                    if (!src || src === '') {
                      return null
                    }
                    return <img src={src} {...props} />
                  },
                }}
              >
                {workflow.readme}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
