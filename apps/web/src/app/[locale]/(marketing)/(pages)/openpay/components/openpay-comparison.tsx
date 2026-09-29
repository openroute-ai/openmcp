import type { LucideIcon } from 'lucide-react'
import { ArrowRight, BadgeDollarSign, Box, CircleCheck, PackageX } from 'lucide-react'
import { Fragment } from 'react'
import { getTranslations } from 'next-intl/server'

type Side = {
  key: 'free' | 'paid'
  icon: LucideIcon
  itemIcon: LucideIcon
  itemKeys: readonly string[]
  iconClass: string
  itemIconClass: string
  listTone: string
  cardClass: string
  footerClass: string
  footerValueClass: string
}

const sides: readonly Side[] = [
  {
    key: 'free',
    icon: Box,
    itemIcon: PackageX,
    itemKeys: ['download', 'exposure', 'noContact'],
    iconClass: 'bg-muted text-muted-foreground',
    itemIconClass: 'text-muted-foreground/50',
    listTone: 'text-muted-foreground',
    cardClass: 'border-border bg-card',
    footerClass: 'border-border text-muted-foreground',
    footerValueClass: 'text-muted-foreground/70',
  },
  {
    key: 'paid',
    icon: BadgeDollarSign,
    itemIcon: CircleCheck,
    itemKeys: ['collect', 'models', 'inflow'],
    iconClass: 'bg-primary text-primary-foreground',
    itemIconClass: 'text-primary',
    listTone: 'text-foreground',
    cardClass: 'border-primary/40 bg-primary/5',
    footerClass: 'border-primary/20 text-primary',
    footerValueClass: 'text-primary',
  },
]

export async function OpenpayComparison() {
  const t = await getTranslations('OpenPayPage.comparison')

  return (
    <section className='px-gutter py-section sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mx-auto max-w-5xl'>
        <div className='mb-12 text-center'>
          <span className='mb-4 inline-block rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground text-xs'>
            {t('eyebrow')}
          </span>
          <h2 className='text-balance font-medium text-foreground text-subtitle tracking-tight md:text-4xl'>
            {t('title')}
          </h2>
        </div>

        <div className='mt-4 grid items-stretch gap-6 md:grid-cols-[1fr_auto_1fr]'>
          {sides.map((side, index) => {
            const Icon = side.icon
            const ItemIcon = side.itemIcon

            return (
              <Fragment key={side.key}>
                <div className={`rounded-2xl border p-8 ${side.cardClass}`}>
                  <div className='mb-6 flex items-center gap-3'>
                    <div className={`w-fit rounded-lg p-3 ${side.iconClass}`}>
                      <Icon className='size-5' />
                    </div>
                    <h3 className='font-medium text-lg text-foreground'>{t(`${side.key}.title`)}</h3>
                  </div>
                  <ul className='space-y-4'>
                    {side.itemKeys.map((itemKey) => (
                      <li key={itemKey} className={`flex items-start gap-3 ${side.listTone}`}>
                        <ItemIcon className={`mt-0.5 size-4 shrink-0 ${side.itemIconClass}`} />
                        {t(`${side.key}.items.${itemKey}`)}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-8 border-t pt-5 text-sm ${side.footerClass}`}>
                    {t(`${side.key}.earningsLabel`)}：
                    <span className={side.footerValueClass}> {t(`${side.key}.earningsValue`)}</span>
                  </p>
                </div>

                {index === 0 && (
                  <div className='flex items-center justify-center'>
                    <span className='inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 font-medium text-primary text-sm'>
                      {t('paid.badge')}
                      <ArrowRight className='size-4' />
                    </span>
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
    </section>
  )
}
