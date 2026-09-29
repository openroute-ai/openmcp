'use client'

import { useTranslations } from 'next-intl'
import type React from 'react'
import Container from '@/components/layout/container'
import { Logo } from '@/components/layout/logo'
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
      <Container className='px-4'>
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
        </div>
      </Container>

      <div className='border-t py-5'>
        <Container className='px-4'>
          <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8'>
            <div className='flex flex-col gap-1 md:max-w-[559px]'>
              <p className='text-black/50 text-xs leading-[1.67]'>
                内容来源：本站部分 Skill
                内容来源于公开渠道、认证企业或由用户自主发布，使用前请注意甄别风险，内容版权归原作者所有。
              </p>
              <p className='text-black/50 text-xs leading-[1.67]'>
                侵权投诉：如 Skill 涉及版权问题，请发送邮件至{' '}
                <a
                  href='mailto:service@openmcp.cn'
                  className='cursor-pointer text-black/50 transition-colors duration-250 hover:text-foreground'
                >
                  service@openmcp.cn
                </a>
                ，我们将在收到通知后及时核实并予以下架处理。
              </p>
            </div>
            <div className='flex shrink-0 flex-col gap-1 md:text-right'>
              <p className='text-black/50 text-xs leading-[1.67]'>
                Copyright ©2025-Present 天津聚链科技有限公司版权所有
              </p>
              <p className='text-[#71717B] text-xs leading-[1.67]'>
                <a
                  href='https://beian.miit.gov.cn/#/Integrated/index'
                  target='_blank'
                  rel='noopener noreferrer'
                  className='cursor-pointer text-[#71717B] transition-colors duration-250 hover:text-foreground'
                >
                  津ICP备2023007973号
                </a>
              </p>
            </div>
          </div>
        </Container>
      </div>
    </footer>
  )
}
