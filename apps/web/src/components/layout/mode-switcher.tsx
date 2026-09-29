'use client'

import { LaptopIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { websiteConfig } from '@/lib/config/website'

/**
 * Mode switcher component, used in the navbar
 */
export function ModeSwitcher() {
  const { setTheme } = useTheme()
  const t = useTranslations('Common.mode')

  if (!websiteConfig.metadata.mode?.enableSwitch) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='sm' className='size-8 cursor-pointer rounded-full border border-border p-0.5'>
          <SunIcon className='dark:-rotate-90 rotate-0 scale-100 transition-all dark:scale-0' />
          <MoonIcon className='absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100' />
          <span className='sr-only'>{t('label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={() => setTheme('light')} className='cursor-pointer'>
          <SunIcon className='mr-2 size-4' />
          <span>{t('light')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className='cursor-pointer'>
          <MoonIcon className='mr-2 size-4' />
          <span>{t('dark')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')} className='cursor-pointer'>
          <LaptopIcon className='mr-2 size-4' />
          <span>{t('system')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
