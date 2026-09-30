'use client'

import { ArrowLeftIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { LocaleLink } from '@/i18n/navigation'

export default function AllPostsButton() {
  const t = useTranslations('BlogPage')
  return (
    <Button size='lg' variant='default' className='group inline-flex items-center gap-2' asChild>
      <LocaleLink href='/blog'>
        <ArrowLeftIcon className='group-hover:-translate-x-1 h-5 w-5 transition-transform duration-200' />
        <span>{t('allPosts')}</span>
      </LocaleLink>
    </Button>
  )
}
