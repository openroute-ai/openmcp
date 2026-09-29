'use client'

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { describeBillingModel, formatSkillPriceDisplay, type SkillBillingModel } from './skill-billing'

interface SkillCategoryProps {
  category: { name: string; slug: string } | null
  priceType: 'free' | 'paid'
  priceAmount: string | null
  billingModel: SkillBillingModel
  currency: string
  mcpSchemaVersion: string | null
  referenceId: string
  locale: 'zh' | 'en'
}

export function SkillCategory({
  category,
  priceType,
  priceAmount,
  billingModel,
  currency,
  mcpSchemaVersion,
  referenceId,
  locale,
}: SkillCategoryProps) {
  const t = useTranslations('Skills')
  const priceLine = formatSkillPriceDisplay(priceType, priceAmount, currency, locale)
  const licenseLine = describeBillingModel(billingModel, priceType, locale)
  const versionLine = mcpSchemaVersion?.trim() || '—'

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t('category.type'),
      value: locale === 'zh' ? 'Skill' : 'Skill',
    },
    {
      label: t('category.category'),
      value: category ? (
        <LocaleLink
          href={`/workflows?categorySlugs=${category.slug}`}
          className='font-medium text-primary hover:underline'
        >
          {category.name}
        </LocaleLink>
      ) : (
        <span className='text-muted-foreground'>—</span>
      ),
    },
    {
      label: t('category.price'),
      value: <span className='font-medium tabular-nums'>{priceLine}</span>,
    },
    {
      label: t('category.schemaVersion'),
      value: <span className='font-mono text-sm'>{versionLine}</span>,
    },
    {
      label: t('category.billing'),
      value: <span className='font-medium'>{licenseLine}</span>,
    }
  ]

  return (
    <Card className='rounded-lg border border-border bg-card shadow-sm'>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base'>{t('category.details')}</CardTitle>
      </CardHeader>
      <CardContent className='pt-0'>
        <dl className='space-y-3 text-sm'>
          {rows.map((row) => (
            <div key={row.label} className='flex justify-between gap-4'>
              <dt className='shrink-0 text-muted-foreground'>{row.label}</dt>
              <dd className='min-w-0 text-right text-foreground'>{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
