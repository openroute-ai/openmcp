// import { BlurFadeDemo } from "@/components/magicui/example/blur-fade-example";
import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Button, buttonVariants } from '@workspace/ui/components/button'
import { MailIcon, X } from 'lucide-react'
import type { Metadata } from 'next'
import type { Locale } from '@/i18n/routing'
import { getTranslations } from 'next-intl/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { WeChatQRDialog } from '@/components/contact/wechat-qr-dialog'
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
      <div className='mx-auto max-w-4xl space-y-8'>
        {/* about section */}
        <div className='relative mx-auto mt-8 mb-24 max-w-(--breakpoint-md) md:mt-16'>
          <div className='mx-auto flex flex-col justify-between'>
            <div className='grid gap-8 sm:grid-cols-2'>
              {/* avatar and name */}
              <div className='flex items-center gap-8'>
                <Avatar className='size-24 p-0.5'>
                  <AvatarImage className='rounded-full border-4 border-gray-200' src='/logo.png' alt='Avatar' />
                  <AvatarFallback>
                    <div className='size-24 text-muted-foreground' />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h1 className='text-foreground text-section'>{t('authorName')}</h1>
                  <p className='mt-2 text-base text-muted-foreground'>{t('authorBio')}</p>
                </div>
              </div>

              {/* introduction */}
              <div>
                <div className='prose dark:prose-invert prose-headings:my-6 prose-li:my-2 prose-p:my-4 prose-ul:my-4 mb-8 max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground text-base'>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{t('introduction')}</ReactMarkdown>
                </div>

                <div className='flex flex-wrap items-center gap-4'>
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
              </div>
            </div>
          </div>
        </div>

        {/* image section */}
        {/* <BlurFadeDemo /> */}
      </div>
    </Container>
  )
}
