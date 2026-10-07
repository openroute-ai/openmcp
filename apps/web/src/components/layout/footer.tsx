'use client'

import { useTranslations } from 'next-intl'
import type React from 'react'
import Container from '@/components/layout/container'
import { Logo } from '@/components/layout/logo'
import { NewsletterSignupForm } from '@/components/layout/newsletter-signup-form'
import { LocaleLink } from '@/i18n/navigation'
import { getFooterLinks } from '@/lib/config/footer-config'
import { getSocialLinks } from '@/lib/config/social-config'
import { cn } from '@/lib/utils'

export function Footer({ className }: React.HTMLAttributes<HTMLElement>) {
  const t = useTranslations()
  const footerLinks = getFooterLinks()
  const socialLinks = getSocialLinks()

  return (
    <footer className={cn('border-t', className)}>
      <Container className='px-5'>
        <div className='grid grid-cols-2 gap-8 py-16 md:grid-cols-6'>
          <div className='col-span-full flex flex-col items-start md:col-span-2'>
            <div className='space-y-4'>
              {/* logo and name */}
              <div className='flex items-center space-x-2'>
                <Logo />
                <span className='font-semibold text-xl'>{t('Metadata.name')}</span>
              </div>

              {/* tagline */}
              <p className='py-2 text-base text-muted-foreground md:pr-12'>{t('Marketing.footer.tagline')}</p>

              {/* social links */}
              <div className='flex items-center gap-4 py-2'>
                <div className='flex items-center gap-2'>
                  {socialLinks?.map((link) => (
                    <a
                      key={link.title}
                      href={link.href || '#'}
                      target='_blank'
                      rel='noreferrer'
                      aria-label={link.title}
                      className='inline-flex h-8 w-8 items-center justify-center rounded-full border border-border hover:bg-accent hover:text-accent-foreground'
                    >
                      <span className='sr-only'>{link.title}</span>
                      {link.icon ? link.icon : null}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* footer links */}
          {footerLinks?.map((section) => (
            <div key={section.title} className='col-span-1 items-start md:col-span-1'>
              <span className='font-semibold text-sm uppercase'>{section.title}</span>
              <ul className='mt-4 list-inside space-y-3'>
                {section.items?.map(
                  (item) =>
                    item.href && (
                      <li key={item.title}>
                        <LocaleLink
                          href={item.href || '#'}
                          target={item.external ? '_blank' : undefined}
                          className='text-muted-foreground text-sm hover:text-primary'
                        >
                          {item.title}
                        </LocaleLink>
                      </li>
                    )
                )}
              </ul>
            </div>
          ))}

          <div className='col-span-2 items-start md:col-span-2'>
            <NewsletterSignupForm />
          </div>
        </div>
      </Container>

      <div className='border-t py-5'>
        <Container className='px-5'>
          <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8'>
            <div className='flex flex-col gap-1 md:max-w-[559px]'>
              <p className='text-black/50 text-xs leading-[1.67]'>
                {t('Marketing.footer.disclaimer.contentSource')}
              </p>
              <p className='text-black/50 text-xs leading-[1.67]'>
                {t.rich('Marketing.footer.disclaimer.infringement', {
                  link: () => (
                    <a
                      href='mailto:service@openmcp.cn'
                      className='cursor-pointer text-black/50 transition-colors duration-250 hover:text-foreground'
                    >
                      service@openmcp.cn
                    </a>
                  ),
                })}
              </p>
            </div>
            <div className='flex shrink-0 flex-col gap-1 md:text-right'>
              <p className='text-black/50 text-xs leading-[1.67]'>
                {t('Marketing.footer.disclaimer.copyright')}
              </p>
              <p className='text-[#71717B] text-xs leading-[1.67]'>
                <a
                  href='https://beian.miit.gov.cn/#/Integrated/index'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='cursor-pointer text-[#71717B] transition-colors duration-250 hover:text-foreground'
                >
                  {t('Marketing.footer.disclaimer.icp')}
                </a>
              </p>
            </div>
          </div>
        </Container>
      </div>
    </footer>
  )
}
