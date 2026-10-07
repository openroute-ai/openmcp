import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Banknote,
  Braces,
  Database,
  Gauge,
  KeyRound,
  Layers,
  ShieldCheck,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { SectionHeading } from './section-heading'

interface PlatformCapability {
  icon: LucideIcon
  key: string
}

/**
 * 只保留「平台底座」层面的能力。
 * 信任与审核类（资质认证 / 安全审核 / 内容指纹）统一由 PublishJourney 承载，此处不再重复。
 */
const capabilities: PlatformCapability[] = [
  { icon: Layers, key: 'protocol' },
  { icon: Database, key: 'registry' },
  { icon: Gauge, key: 'metering' },
  { icon: KeyRound, key: 'keys' },
  { icon: Banknote, key: 'settlement' },
  { icon: Braces, key: 'api' },
]

export async function Platform() {
  const t = await getTranslations('Landing.platform')

  return (
    <section id="features" className="py-18">
      <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-16">
          <div className="lg:sticky lg:top-24">
            <SectionHeading
              eyebrow={t('eyebrow')}
              icon={<ShieldCheck className="h-3.5 w-3.5 text-primary" />}
              title={t('title')}
              description={t('description')}
            />
            <LocaleLink
              href={Routes.Docs}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 transition hover:underline"
            >
              {t('cta')}
              <ArrowRight className="h-4 w-4" />
            </LocaleLink>
          </div>

          <div className="grid gap-px overflow-hidden rounded-[20px] border border-border bg-border sm:grid-cols-2">
            {capabilities.map((capability, i) => (
              <div
                key={capability.key}
                className="group flex items-center gap-4 bg-card p-5 transition hover:bg-muted/60"
              >
                <span className="shrink-0 font-mono text-sm text-muted-foreground">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="w-fit rounded-lg bg-primary/10 p-2.5 text-primary">
                  <capability.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium">
                    {t(`capabilities.${capability.key}.title`)}
                  </h3>
                  <p className="truncate text-sm text-muted-foreground">
                    {t(`capabilities.${capability.key}.description`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
