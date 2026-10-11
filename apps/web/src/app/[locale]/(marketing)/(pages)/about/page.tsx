// import { BlurFadeDemo } from "@/components/magicui/example/blur-fade-example";
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { MailIcon, X } from 'lucide-react'
import type { Metadata } from 'next'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { WeChatQRDialog } from '@/components/contact/wechat-qr-dialog'
import { LogoIcon } from '@/components/icons/logo'
import Container from '@/components/layout/container'
import { websiteConfig } from '@/lib/config/website'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { cn } from '@/lib/utils'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata | undefined> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Metadata' })
  const pt = await getTranslations({ locale, namespace: 'AboutPage' })

  return constructMetadata({
    title: `${pt('title')} | ${t('title')}`,
    description: pt('description'),
    canonicalUrl: getUrlWithLocale('/about', locale),
  })
}

/**
 * inspired by https://astro-nomy.vercel.app/about
 */
export default async function AboutPage() {
  const t = await getTranslations('AboutPage')

  return (
    <Container className='px-5 py-16'>
      <div className='mx-auto max-w-3xl'>
        {/* hero: avatar and name */}
        <div className='flex flex-col items-center gap-5 text-center'>
          <div className='flex size-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20'>
            <LogoIcon className='size-11 text-primary' aria-label={t('authorName')} />
          </div>
          <div className='space-y-2'>
            <h1 className='font-semibold text-2xl text-foreground sm:text-3xl'>{t('authorName')}</h1>
            <p className='text-muted-foreground'>{t('authorBio')}</p>
          </div>
        </div>

        {/* introduction */}
        <div className='prose dark:prose-invert prose-headings:my-6 prose-li:my-2 prose-p:my-4 prose-ul:my-4 mt-12 max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground text-base'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{t('introduction')}</ReactMarkdown>
        </div>

        {/* actions */}
        <div className='mt-12 flex flex-wrap items-center justify-center gap-4 border-t pt-8'>
          {websiteConfig.metadata.social?.twitter && (
            <a
              href={websiteConfig.metadata.social.twitter}
              target='_blank'
              rel='noopener noreferrer'
              className={cn(buttonVariants({ variant: 'outline' }), 'cursor-pointer rounded-lg')}
            >
              <X className='mr-1 size-4' />
              {t('followMe')}
            </a>
          )}
          {websiteConfig.mail.supportEmail && (
            <div className='flex items-center gap-4'>
              <Button className='cursor-pointer rounded-lg' variant='outline'>
                <MailIcon className='mr-1 size-4' />
                <a href={`mailto:${websiteConfig.mail.supportEmail}`}>{t('talkWithMe')}</a>
              </Button>
            </div>
          )}
          <WeChatQRDialog
            qrCodeUrl='/images/contact-wechat.webp'
            wechatId='OpenRouteAI'
            buttonText={t('contactWeChat')}
            buttonVariant='default'
            showIcon={true}
            className='w-full sm:w-auto'
          />
        </div>

        {/* image section */}
        {/* <BlurFadeDemo /> */}
      </div>
    </Container>
  )
}
