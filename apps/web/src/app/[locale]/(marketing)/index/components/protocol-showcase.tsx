import { Button } from '@workspace/ui/components/button'
import { ArrowRight, BadgeCheck } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { CopyPrompt } from '@/components/copy-prompt'
import { LocaleLink } from '@/i18n/navigation'
import { installPromptFor } from '@/lib/marketing/install-prompt'
import { Routes } from '@/lib/routes'

const protocols = [
  { chip: 'SKILL.md', key: 'skill', href: Routes.Skills },
  { chip: 'MCP', key: 'mcp', href: Routes.MCP },
  { chip: 'A2A', key: 'a2a', href: Routes.A2A },
]

export async function ProtocolShowcase() {
  const [t, locale] = await Promise.all([getTranslations('HomePage.protocols'), getLocale()])

  return (
    <section className='py-10 md:py-16'>
      <div className='mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='grid items-center gap-10 rounded-[20px] bg-muted p-8 md:p-12 lg:grid-cols-[0.62fr_1.38fr]'>
          <div>
            <span className='mb-5 inline-block rounded-full border border-border bg-background px-3 py-1 font-medium text-muted-foreground text-xs'>
              {t('eyebrow')}
            </span>
            <h2 className='mb-5 text-balance font-medium text-title tracking-tight'>{t('title')}</h2>
            <p className='mb-8 text-pretty text-muted-foreground leading-relaxed'>{t('subtitle')}</p>
            <div className='flex flex-wrap gap-3'>
              <Button size='lg' className='h-auto rounded-full px-5 py-2.5 text-sm' asChild>
                <LocaleLink href={Routes.Skills}>
                  {t('ctaBrowse')}
                  <ArrowRight className='ml-2 h-4 w-4' />
                </LocaleLink>
              </Button>
              <Button
                size='lg'
                variant='outline'
                className='h-auto rounded-full px-5 py-2.5 text-foreground text-sm'
                asChild
              >
                <LocaleLink href={Routes.ProviderOnboarding}>{t('ctaProvider')}</LocaleLink>
              </Button>
              <CopyPrompt
                text={installPromptFor(locale)}
                label={t('ctaCopy')}
                className='border border-border bg-background text-foreground hover:bg-muted'
              />
            </div>
          </div>

          <div className='space-y-3'>
            {protocols.map((protocol) => (
              <LocaleLink
                key={protocol.chip}
                href={protocol.href}
                className='group flex items-center gap-4 rounded-2xl border border-border bg-background px-5 py-4 transition hover:border-primary/50'
              >
                <span className='w-fit shrink-0 rounded-lg bg-foreground px-2.5 py-1 font-medium font-mono text-background text-xs'>
                  {protocol.chip}
                </span>
                <div className='min-w-0'>
                  <h3 className='flex items-center gap-2 font-medium'>
                    {t(`items.${protocol.key}.name`)}
                    <span className='inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs'>
                      <BadgeCheck className='h-3 w-3' />
                      {t(`items.${protocol.key}.badge`)}
                    </span>
                  </h3>
                  <p className='truncate text-muted-foreground text-sm'>
                    {t(`items.${protocol.key}.description`)}
                  </p>
                </div>
                <ArrowRight className='ml-auto h-4 w-4 shrink-0 text-border transition group-hover:text-primary' />
              </LocaleLink>
            ))}
            <p className='pt-1 text-muted-foreground text-xs'>{t('footerNote')}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
