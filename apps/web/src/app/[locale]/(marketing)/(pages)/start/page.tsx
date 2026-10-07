import { Button } from '@workspace/ui/components/button'
import { ArrowRight, Compass, Rocket, Store, Upload } from 'lucide-react'
import type { Metadata } from 'next'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { InstallIntoAgent } from '@/components/agent-install/install-into-agent'
import { CopyPrompt } from '@/components/copy-prompt'
import { LocaleLink } from '@/i18n/navigation'
import { buildStoreBootstrapCopyPrompt, getAppBaseUrl } from '@/lib/agent-install'
import { constructMetadata } from '@/lib/metadata'
import { Routes } from '@/lib/routes'
import { getUrlWithLocale } from '@/lib/urls/urls'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'StartPage' })
  const meta = await getTranslations({ locale, namespace: 'Metadata' })

  return constructMetadata({
    title: `${t('title')} | ${meta('name')}`,
    description: t('description'),
    canonicalUrl: getUrlWithLocale('/start', locale),
    locale,
  })
}

interface StartPageProps {
  params: Promise<{ locale: Locale }>
}

export default async function StartPage({ params }: StartPageProps) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'StartPage' })
  const loc = (locale === 'zh' ? 'zh' : 'en') as 'zh' | 'en'

  const steps = [
    {
      icon: Store,
      title: t('steps.one.title'),
      body: t('steps.one.body'),
    },
    {
      icon: Compass,
      title: t('steps.two.title'),
      body: t('steps.two.body'),
    },
    {
      icon: Upload,
      title: t('steps.three.title'),
      body: t('steps.three.body'),
    },
  ]

  return (
    <div className='flex flex-col'>
      <section className='relative pt-12 pb-12 md:pb-16'>
        <div className='mx-auto w-full max-w-7xl'>
          <div className='mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-1.5 text-muted-foreground text-small'>
            <Store className='h-4 w-4 text-primary' />
            <span>{t('badge')}</span>
          </div>

          <h1 className='mb-4 max-w-3xl text-balance font-medium text-foreground text-title tracking-tight'>
            {t('heading')}
          </h1>
          <p className='mb-8 max-w-2xl text-pretty text-lead text-muted-foreground'>{t('intro')}</p>

          <div className='mb-8 rounded-2xl border border-border bg-card p-5 shadow-sm'>
            <h2 className='mb-2 font-medium text-foreground text-xl'>
              {loc === 'zh' ? '复制给 AI 安装 OpenMCP 商店' : 'Copy to AI to install OpenMCP store'}
            </h2>
            <p className='mb-3 text-muted-foreground text-small'>
              {loc === 'zh'
                ? '把下面的短提示词发给 Cursor / Claude Code / Codex，Agent 会按 /install/openmcp.md 完成商店接入与 Skill 包安装。'
                : 'Paste the short prompt into Cursor / Claude Code / Codex. The Agent follows /install/openmcp.md to wire the store and install Skill packages.'}
            </p>
            <div className='mb-3 rounded-md border border-dashed bg-muted/30 px-3 py-2 font-mono text-caption text-muted-foreground'>
              {buildStoreBootstrapCopyPrompt({ locale: loc })}
            </div>
            <div className='flex flex-wrap gap-2'>
              <CopyPrompt
                text={buildStoreBootstrapCopyPrompt({ locale: loc })}
                label={loc === 'zh' ? '复制给 AI 安装' : 'Copy for AI install'}
                className='bg-foreground text-background hover:bg-primary'
              />
              <Button size='sm' variant='outline' asChild>
                <a href='/install/openmcp.md' target='_blank' rel='noreferrer'>
                  openmcp.md
                </a>
              </Button>
              <Button size='sm' variant='outline' asChild>
                <a href='/api/skills/openmcp-store/package'>
                  {loc === 'zh' ? '下载商店 Helper Zip' : 'Download store helper Zip'}
                </a>
              </Button>
            </div>
          </div>
          <InstallIntoAgent
            kind='skill'
            locale={loc}
            bootstrap
            includeStoreMcp
            asset={{
              id: 'openmcp-store',
              name: 'OpenMCP Store',
              slug: 'openmcp-store',
              priceType: 'free',
            }}
            origin={getAppBaseUrl()}
            className='mb-8'
          />

          <div className='flex flex-wrap gap-3'>
            <Button size='lg' className='rounded-full' asChild>
              <LocaleLink href={Routes.Skills}>
                {t('cta.browse')}
                <ArrowRight className='ml-2 h-4 w-4' />
              </LocaleLink>
            </Button>
            <Button size='lg' variant='outline' className='rounded-full' asChild>
              <LocaleLink href={Routes.ProviderOnboarding}>{t('cta.provider')}</LocaleLink>
            </Button>
          </div>
        </div>
      </section>

      <section className='pb-16 md:pb-24'>
        <div className='mx-auto w-full max-w-7xl'>
          <h2 className='mb-8 font-medium text-foreground text-section tracking-tight'>{t('stepsHeading')}</h2>
          <ol className='space-y-6'>
            {steps.map((step, i) => (
              <li key={step.title} className='flex gap-5 rounded-2xl border border-border bg-card p-6'>
                <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-foreground/15 font-medium'>
                  {i + 1}
                </div>
                <div className='min-w-0'>
                  <div className='mb-2 flex items-center gap-2'>
                    <step.icon className='h-4 w-4 text-primary' />
                    <h3 className='font-medium text-foreground text-xl'>{step.title}</h3>
                  </div>
                  <p className='max-w-prose text-pretty text-body text-muted-foreground'>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className='mt-6 flex flex-wrap gap-3 text-small'>
            <LocaleLink href={Routes.Skills} className='text-primary underline-offset-4 hover:underline'>
              Skills
            </LocaleLink>
            <span className='text-border'>·</span>
            <LocaleLink href={Routes.MCP} className='text-primary underline-offset-4 hover:underline'>
              MCP
            </LocaleLink>
            <span className='text-border'>·</span>
            <LocaleLink href={Routes.A2A} className='text-primary underline-offset-4 hover:underline'>
              A2A
            </LocaleLink>
          </div>
        </div>
      </section>

      <section className='border-t py-16 md:py-18'>
        <div className='mx-auto w-full max-w-7xl'>
          <div className='rounded-2xl border border-primary/40 border-dashed bg-background p-8 md:p-10'>
            <div className='mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 font-medium text-caption text-primary'>
              <Rocket className='h-3.5 w-3.5' />
              {t('future.badge')}
            </div>
            <h2 className='mb-3 font-medium text-foreground text-section tracking-tight'>{t('future.title')}</h2>
            <p className='mb-6 max-w-prose text-pretty text-lead text-muted-foreground'>{t('future.body')}</p>
            <ul className='mb-8 list-disc space-y-2 pl-5 text-muted-foreground text-small'>
              <li>{t('future.bullets.one')}</li>
              <li>{t('future.bullets.two')}</li>
              <li>{t('future.bullets.three')}</li>
            </ul>
            <p className='text-caption text-muted-foreground'>{t('future.note')}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
