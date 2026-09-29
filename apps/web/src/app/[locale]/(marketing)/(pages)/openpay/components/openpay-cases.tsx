import { BadgeCent, Building2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const cases = [
  { key: 'workRally' },
  { key: 'trip' },
  { key: 'luckin' },
  { key: 'wind' },
  { key: 'tencent' },
  { key: 'tongdaxin' },
] as const

export async function OpenpayCases() {
  const t = await getTranslations('OpenPayPage.cases')

  return (
    <section className='overflow-hidden px-gutter py-section'>
      <div className='mx-auto max-w-5xl'>
        <div className='mb-12 text-center'>
          <span className='mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 font-medium text-muted-foreground text-xs'>
            <Building2 className='size-3.5 text-primary' />
            {t('eyebrow')}
          </span>
          <h2 className='text-balance font-medium text-foreground text-subtitle tracking-tight md:text-4xl'>
            {t('title')}
          </h2>
        </div>

        <div className='no-scrollbar -mx-gutter flex snap-x gap-4 overflow-x-auto px-gutter pb-2'>
          {cases.map(({ key }) => (
            <div
              key={key}
              className='flex w-64 shrink-0 snap-start flex-col rounded-2xl border border-border bg-card p-6'
            >
              <div className='mb-3 h-10 w-10 rounded-lg bg-primary/10 text-primary' aria-hidden='true'>
                <BadgeCent className='h-full w-full p-2' />
              </div>
              <h3 className='mb-1 font-medium'>{t(`items.${key}.name`)}</h3>
              <p className='mb-4 text-muted-foreground text-sm'>{t(`items.${key}.scene`)}</p>
              <p className='mt-auto inline-flex w-fit items-center rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary text-xs'>
                {t(`items.${key}.price`)}
              </p>
            </div>
          ))}
        </div>
        <p className='pt-4 text-center text-muted-foreground text-xs'>{t('disclaimer')}</p>
      </div>
    </section>
  )
}
