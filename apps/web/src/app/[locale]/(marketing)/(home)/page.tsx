import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { CapabilityCarousel } from './components/capability-carousel'
import { Hero } from './components/hero'
import { Metrics } from './components/metrics'
import { Onboarding } from './components/onboarding'
import { Platform } from './components/platform'
import { ProviderCta } from './components/provider-cta'
import { PublishJourney } from './components/publish-journey'

/**
 * 精简版落地页：7 段结构，每段只承担一个信息目标。
 *
 * 1. Hero               唯一的主 CTA 对 + 安装提示 + 运行时兼容承诺
 * 2. CapabilityCarousel 三协议货架（Skills / MCP / A2A）
 * 3. Platform           平台底座能力（统一注册、计量、密钥、结算、开放 API）
 * 4. PublishJourney     个人 / 企业发布全流程，信任与审核卖点统一由这里承载
 * 5. ProviderCta        发布收益 + 可选付费（原 RevenueCta + OpenpayHomeCta 合并）
 * 6. Metrics            目录规模数字
 * 7. Onboarding         收尾 CTA
 *
 * 本目录即首页路由（`/`）。原 11 段的实现已移至 `../index/`。
 *
 * https://next-intl.dev/docs/environments/actions-metadata-route-handlers#metadata-api
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata | undefined> {
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale
  const t = await getTranslations({ locale, namespace: 'Metadata' })

  return constructMetadata({
    title: t('title'),
    description: t('description'),
    canonicalUrl: getUrlWithLocale('', locale),
    locale,
  })
}

export default async function HomePage() {
  return (
    <div className="flex flex-col">
      <Hero />
      <CapabilityCarousel />
      <Platform />
      <Metrics />
      <PublishJourney />
      <ProviderCta />

      <Onboarding />
    </div>
  )
}
