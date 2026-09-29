'use client'

import { FileArchive, MessageSquareText, Quote } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CopyPrompt } from '@/components/copy-prompt'

export interface PersonaSoul {
  code: string
  name: string
  tagline: string | null
  interpretation: string | null
  prompt: string | null
}

interface PersonaDetailSoulProps {
  soul: PersonaSoul
}

const INSTALL_DOC = 'https://www.openmcp.cn/install/openmcp.md'

export function PersonaDetailSoul({ soul }: PersonaDetailSoulProps) {
  const t = useTranslations('PersonaPage.detail.soul')

  const shortName = `${soul.code}・${soul.name}`
  // The provider may supply a ready-made prompt; otherwise fall back to the
  // generic install instruction pointing at the shared install doc.
  const installPrompt = soul.prompt || t('installPrompt', { code: soul.code, doc: INSTALL_DOC })

  return (
    <div className='space-y-6'>
      <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <div className='mb-4 flex items-center gap-2'>
          <Quote className='h-5 w-5 text-primary' />
          <h2 className='font-semibold text-lg'>{t('taglineHeading')}</h2>
        </div>
        <blockquote className='border-primary border-l-4 bg-muted/40 px-4 py-3 text-muted-foreground italic'>
          {soul.tagline || t('noTagline')}
          <span className='mt-2 block text-muted-foreground/70 text-sm'>—— {shortName}</span>
        </blockquote>
      </section>

      <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <h2 className='mb-4 font-semibold text-lg'>{t('profileHeading')}</h2>
        <p className='text-muted-foreground leading-relaxed whitespace-pre-line'>
          {soul.interpretation || t('noProfile')}
        </p>
      </section>

      <section className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <h2 className='mb-4 font-semibold text-lg'>{t('installHeading')}</h2>
        <div className='space-y-4'>
          <div className='rounded-lg border border-border bg-muted/30 p-4'>
            <div className='mb-2 flex items-center gap-2'>
              <MessageSquareText className='h-4 w-4 text-primary' />
              <h3 className='font-semibold text-sm'>{t('viaChat')}</h3>
            </div>
            <p className='mb-3 text-muted-foreground text-sm'>{t('viaChatHint', { name: shortName })}</p>
            <pre className='max-h-64 overflow-auto rounded-md border border-border bg-background p-4 text-sm leading-relaxed whitespace-pre-wrap'>
              {installPrompt}
            </pre>
            <div className='mt-3 flex justify-end'>
              <CopyPrompt
                text={installPrompt}
                label={t('copyPrompt')}
                className='bg-primary text-primary-foreground hover:bg-primary/90'
              />
            </div>
          </div>

          <div className='flex items-center gap-3 rounded-lg border border-dashed border-border p-4 opacity-70'>
            <FileArchive className='h-5 w-5 text-muted-foreground' />
            <div className='text-muted-foreground text-sm'>
              <p className='font-semibold'>{t('zipTitle')}</p>
              <p>{t('zipHint')}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
