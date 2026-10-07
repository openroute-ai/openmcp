import type { LucideIcon } from 'lucide-react'
import { CircleCheck, Network, Repeat, WalletCards } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

const capabilities: { icon: LucideIcon; key: 'wallet' | 'migrate' | 'inflow' | 'distribute' }[] = [
  { icon: WalletCards, key: 'wallet' },
  { icon: Repeat, key: 'migrate' },
  { icon: CircleCheck, key: 'inflow' },
  { icon: Network, key: 'distribute' },
]

export async function OpenpayCapabilities() {
  const t = await getTranslations('OpenPayPage.capabilities')

  return (
    <section className='border-border border-y bg-muted/40 px-5 py-18 sm:px-6 lg:px-10'>
      <div className='mx-auto max-w-5xl'>
        <div className='mb-12 text-center'>
          <span className='mb-4 inline-block rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs'>
            {t('eyebrow')}
          </span>
          <h2 className='text-balance font-medium text-foreground text-subtitle tracking-tight md:text-4xl'>
            {t('title')}
          </h2>
        </div>

        <div className='grid gap-6 md:grid-cols-2'>
          {capabilities.map(({ icon: Icon, key }) => (
            <div
              key={key}
              className='rounded-2xl border border-border bg-card p-8 transition-colors hover:border-primary/40'
            >
              <div className='mb-5 w-fit rounded-lg bg-primary/10 p-3 text-primary'>
                <Icon className='size-5' />
              </div>
              <h3 className='mb-2 font-medium text-lg'>{t(`items.${key}.title`)}</h3>
              <p className='text-pretty text-muted-foreground leading-relaxed'>{t(`items.${key}.description`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
