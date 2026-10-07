'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@workspace/ui/components/accordion'
import { useTranslations } from 'next-intl'

const faqs = [
  { key: 'difference' },
  { key: 'qualification' },
  { key: 'bothChannels' },
  { key: 'payout' },
  { key: 'migrate' },
] as const

export function OpenpayFaq() {
  const t = useTranslations('OpenPayPage.faq')

  return (
    <section className='px-5 py-18 sm:px-6 lg:px-10'>
      <div className='mx-auto max-w-3xl'>
        <div className='mb-10 text-center'>
          <span className='mb-4 inline-block rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground text-xs'>
            {t('eyebrow')}
          </span>
          <h2 className='text-balance font-medium text-foreground text-3xl tracking-tight md:text-4xl'>
            {t('title')}
          </h2>
        </div>

        <Accordion type='single' collapsible className='rounded-2xl border border-border bg-card px-6'>
          {faqs.map(({ key }, i) => (
            <AccordionItem key={key} value={`item-${i}`}>
              <AccordionTrigger className='text-left font-medium'>
                <span>{t(`items.${key}.question`)}</span>
              </AccordionTrigger>
              <AccordionContent>
                <span className='text-muted-foreground leading-relaxed'>{t(`items.${key}.answer`)}</span>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
