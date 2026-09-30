'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useTranslations } from 'next-intl'

const FAQ_KEYS = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'] as const

export function ClawsourcingQa() {
  const t = useTranslations('ClawsourcingPage.qa')

  return (
    <section className='border-border border-b bg-card px-6 py-section'>
      <div className='mx-auto max-w-5xl'>
        <div className='mb-10 text-center'>
          <h2 className='font-bold text-3xl text-foreground md:text-4xl'>{t('title')}</h2>
        </div>
        <div className='space-y-5'>
          {FAQ_KEYS.map((key) => (
            <Card key={key} className='border-border bg-card shadow-sm'>
              <CardHeader className='space-y-0 pt-5 pb-2'>
                <CardTitle className='font-semibold text-base text-foreground leading-snug'>
                  {t(`faqs.${key}.question`)}
                </CardTitle>
              </CardHeader>
              <CardContent className='pt-0 pb-5'>
                <p className='text-muted-foreground text-sm leading-relaxed'>{t(`faqs.${key}.answer`)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
