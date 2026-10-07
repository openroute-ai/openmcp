import { getTranslations } from 'next-intl/server'

const metrics = [
  { value: '50+', key: 'skills' },
  { value: '100+', key: 'mcp' },
  { value: '10+', key: 'a2a' },
  { value: '90%', key: 'revenue' },
] as const

export async function Metrics() {
  const t = await getTranslations('Landing.metrics')

  return (
    <section className="py-16 md:py-18">
      <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
        <div className="grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.key}
              className="flex flex-col items-center justify-center gap-1 bg-card p-8 text-center lg:p-10"
            >
              <div className="text-title font-semibold tracking-tight">
                {metric.value}
              </div>
              <div className="mt-1 font-medium text-muted-foreground">
                {t(`${metric.key}.label`)}
              </div>
              <div className="text-sm text-muted-foreground/70">
                {t(`${metric.key}.caption`)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
