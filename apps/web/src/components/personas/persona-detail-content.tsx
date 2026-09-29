'use client'

import { useTranslations } from 'next-intl'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface PersonaDetailContentProps {
  description: string
}

export function PersonaDetailContent({ description }: PersonaDetailContentProps) {
  const t = useTranslations('PersonaPage.detail')

  return (
    <section className='mb-8 rounded-lg border border-border bg-card p-6 shadow-sm'>
      <h2 className='mb-4 font-semibold text-lg'>{t('description')}</h2>
      <div className='prose dark:prose-invert prose-p:my-4 max-w-none prose-headings:scroll-mt-20 prose-code:rounded prose-pre:border prose-pre:border-border prose-code:bg-muted prose-pre:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-headings:font-bold prose-a:text-primary prose-code:text-foreground prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-strong:text-foreground prose-p:leading-relaxed prose-a:no-underline prose-code:before:content-none prose-code:after:content-none hover:prose-a:underline'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Descriptions come from providers, so a missing source is dropped
            // rather than rendered as a broken image.
            img: ({ src, ...props }) => (src ? <img src={src} alt='' {...props} /> : null),
          }}
        >
          {description || t('noDescription')}
        </ReactMarkdown>
      </div>
    </section>
  )
}
