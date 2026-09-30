'use client'

import { ExternalLink } from 'lucide-react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@workspace/ui/components/button'
import { LocaleLink } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import type { SiteMessageLink } from '@/lib/site-messages/types'

/** Anything that must not be routed through the locale-aware internal link. */
function isExternalHref(href: string | undefined): boolean {
  if (!href) return false
  return /^(https?:)?\/\//i.test(href) || href.startsWith('mailto:')
}

type SiteMessageBodyProps = {
  content: string
  links?: SiteMessageLink[]
  className?: string
  /** Fired after an internal link is followed, so the overlay can close. */
  onInternalNavigate?: () => void
}

/**
 * Renders a message body.
 *
 * Message bodies are markdown authored by the platform, so `react-markdown`
 * runs them through GFM and only the elements the app actually emits get custom
 * styling. Raw HTML is not enabled — a body is untrusted input from whatever
 * subsystem wrote the row, and must not be able to inject markup.
 */
export function SiteMessageBody({
  content,
  links,
  className,
  onInternalNavigate,
}: SiteMessageBodyProps) {
  const markdownComponents: Components = {
    p: ({ children }) => <p className='mb-3 leading-relaxed last:mb-0'>{children}</p>,
    h3: ({ children }) => (
      <h3 className='mt-4 mb-2 font-semibold text-foreground text-sm first:mt-0'>{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className='mt-3 mb-2 font-medium text-foreground text-sm first:mt-0'>{children}</h4>
    ),
    ul: ({ children }) => (
      <ul className='mb-3 list-disc space-y-1.5 pl-5 marker:text-muted-foreground/70 last:mb-0'>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className='mb-3 list-decimal space-y-1.5 pl-5 marker:text-muted-foreground/70 last:mb-0'>
        {children}
      </ol>
    ),
    li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
    strong: ({ children }) => <strong className='font-medium text-foreground'>{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className='mb-3 border-primary/30 border-l-2 bg-muted/40 px-3 py-2 text-sm last:mb-0 [&>p:last-child]:mb-0'>
        {children}
      </blockquote>
    ),
    hr: () => <hr className='my-4 border-border' />,
    a: ({ href, children }) =>
      isExternalHref(href) ? (
        <a
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:opacity-80'
        >
          {children}
          <ExternalLink className='size-3 shrink-0' />
        </a>
      ) : (
        <LocaleLink
          href={href ?? '#'}
          className='text-primary underline underline-offset-2 hover:opacity-80'
          onClick={onInternalNavigate}
        >
          {children}
        </LocaleLink>
      ),
  }

  return (
    <div className={cn('space-y-4', className)}>
      {content.trim() ? (
        <div className='text-muted-foreground text-sm [&>*:first-child]:mt-0'>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {content}
          </ReactMarkdown>
        </div>
      ) : null}

      {links && links.length > 0 ? (
        <div className='flex flex-wrap gap-2 border-t pt-4'>
          {links.map((link) =>
            link.external || isExternalHref(link.href) ? (
              <Button
                key={`${link.label}-${link.href}`}
                variant='outline'
                size='sm'
                asChild
                className='cursor-pointer'
              >
                <a href={link.href} target='_blank' rel='noopener noreferrer'>
                  {link.label}
                  <ExternalLink className='size-3.5' />
                </a>
              </Button>
            ) : (
              <Button
                key={`${link.label}-${link.href}`}
                variant='outline'
                size='sm'
                asChild
                className='cursor-pointer'
              >
                <LocaleLink href={link.href} onClick={onInternalNavigate}>
                  {link.label}
                </LocaleLink>
              </Button>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}
