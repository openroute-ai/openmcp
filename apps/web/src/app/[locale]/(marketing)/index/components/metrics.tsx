import { getTranslations } from 'next-intl/server'

const METRIC_KEYS = ['skills', 'mcp', 'a2a', 'share'] as const
const METRIC_VALUES = ['50+', '100+', '10+', '90%']

export async function Metrics() {
  const t = await getTranslations('HomePage.metrics')

  return (
    <section className='py-16 md:py-18'>
      <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
        <div className='grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4'>
          {METRIC_KEYS.map((key, i) => (
            <div
              key={key}
              className='flex flex-col items-center justify-center gap-1 bg-card p-8 text-center lg:p-10'
            >
              <div className='font-semibold text-5xl tracking-tight'>{METRIC_VALUES[i]}</div>
              <div className='mt-1 font-medium text-muted-foreground'>{t(`${key}.label`)}</div>
              <div className='text-muted-foreground/70 text-sm'>{t(`${key}.caption`)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
