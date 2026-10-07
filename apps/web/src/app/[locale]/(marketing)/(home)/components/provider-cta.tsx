import { Button } from '@workspace/ui/components/button'
import {
  ArrowRight,
  BadgeCheck,
  BadgeDollarSign,
  CircleCheck,
  TrendingUp,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleLink } from '@/i18n/navigation'
import { chartColor } from '@/lib/chart-colors'
import { MARKET_CTA, PROVIDER_CTA } from '@/lib/marketing/cta'
import { Routes } from '@/lib/routes'

const bars = [38, 62, 45, 78, 58, 92, 70]

/** 示例付费单，展示 OpenPay 按次计价的形态 */
const orderKeys = [1, 2, 3] as const

/**
 * 收尾 section：发布收益 + 可选付费合并为一屏。
 * 原 RevenueCta 与 OpenpayHomeCta 是同一骨架的两次渲染，此处合并为「收益卡 + 计费卡」。
 * 90% 分成全站只在本 section 出现一次。
 */
export async function ProviderCta() {
  const t = await getTranslations('Landing.providerCta')
  const tc = await getTranslations('Landing.cta')

  return (
    <section className="py-18">
      <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
        <div className="grid items-center gap-12 rounded-[24px] border border-border bg-muted/50 p-8 md:p-14 lg:grid-cols-2">
          <div>
            <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <BadgeCheck className="h-3.5 w-3.5 text-primary" />
              {t('eyebrow')}
            </span>
            <h2 className="mb-5 text-title font-medium tracking-tight text-balance">
              {t('titleLead')}
              <br />
              {t('titleAccent')}
            </h2>
            <p className="mb-8 max-w-md leading-relaxed text-pretty text-muted-foreground">
              {t('description')}
            </p>
            <div className="mb-6 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <LocaleLink href={PROVIDER_CTA.href}>
                  {tc('provider')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </LocaleLink>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <LocaleLink href={MARKET_CTA.href}>{tc('browse')}</LocaleLink>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('existingPrefix')}
              <LocaleLink
                href={Routes.Start}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('stepsLink')}
              </LocaleLink>
              {' · '}
              <LocaleLink
                href={Routes.OpenPay}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('openpayLink')}
              </LocaleLink>
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t('installsLabel')}
                  </p>
                  <p className="text-2xl font-semibold tracking-tight">
                    {t('installsValue')}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  <TrendingUp className="h-3 w-3" />
                  {t('sampleBadge')}
                </span>
              </div>
              <div className="mb-6 flex h-24 items-end gap-2">
                {bars.map((height, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-md"
                    style={{
                      height: `${height}%`,
                      backgroundColor: chartColor(i),
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t('revenueLabel')}
                  </p>
                  <p className="text-xl font-semibold tracking-tight text-primary">
                    {t('revenueValue')}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t('revenueNote')}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t('payLabel')}
                  </p>
                  <p className="font-medium text-foreground">{t('payValue')}</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  <BadgeDollarSign className="h-3 w-3" />
                  {t('payBadge')}
                </span>
              </div>
              <div className="space-y-3">
                {orderKeys.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <CircleCheck className="h-4 w-4 text-primary" />
                      {t(`orders.${key}.name`)}
                    </span>
                    <span className="text-sm font-semibold text-primary">
                      {t(`orders.${key}.amount`)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                <span>{t('payFootLeft')}</span>
                <span>{t('payFootRight')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
