import type { Metadata } from 'next'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import { ContactFormCard } from '@/components/contact/contact-form-card'
import { WeChatQRDialog } from '@/components/contact/wechat-qr-dialog'
import Container from '@/components/layout/container'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Metadata' })
  const pt = await getTranslations({ locale, namespace: 'ContactPage' })

  return constructMetadata({
    title: `${pt('title')} | ${t('title')}`,
    description: pt('description'),
    canonicalUrl: getUrlWithLocale('/contact', locale),
  })
}

/**
 * inspired by https://nsui.irung.me/contact
 */
export default async function ContactPage() {
  const t = await getTranslations('ContactPage')

  return (
    <Container className='px-5 py-16'>
      <div className='mx-auto max-w-4xl space-y-8 pb-16'>
        {/* Header */}
        <div className='space-y-4'>
          <h1 className='text-center font-bold text-5xl tracking-tight'>{t('title')}</h1>
          <p className='text-center text-lg text-muted-foreground'>{t('subtitle')}</p>
        </div>

        {/* Form */}
        <ContactFormCard />

        {/* WeChat Contact Section */}
        <div className='flex flex-col items-center space-y-4 border-border border-t pt-8'>
          <div className='space-y-2 text-center'>
            <h3 className='font-semibold text-lg'>{t('wechat.title')}</h3>
            <p className='text-muted-foreground text-sm'>{t('wechat.description')}</p>
          </div>
          <WeChatQRDialog
            qrCodeUrl='/images/contact-wechat.webp'
            wechatId='OpenRouteAI'
            buttonText={t('wechat.contactWeChat')}
            buttonVariant='default'
            showIcon={true}
            className='w-full sm:w-auto'
          />
        </div>
      </div>
    </Container>
  )
}
