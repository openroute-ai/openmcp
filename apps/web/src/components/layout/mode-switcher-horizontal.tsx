'use client'

import { LaptopIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { websiteConfig } from '@/lib/config/website'
import { cn } from '@/lib/utils'

/**
 * Mode switcher component, used in the footer
 */
export function ModeSwitcherHorizontal() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const t = useTranslations('Common.mode')

  // Only show the UI after hydration to prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!websiteConfig.metadata.mode?.enableSwitch) {
    return null
  }

  if (!mounted) {
    return (
      <div className='flex items-center gap-2 rounded-full border p-1'>
        <div className='size-6 rounded-full px-0' />
        <div className='size-6 rounded-full px-0' />
        <div className='size-6 rounded-full px-0' />
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2 rounded-full border p-1'>
      <Button
        variant='ghost'
        size='icon'
        className={cn('size-6 cursor-pointer rounded-full px-0', theme === 'light' && 'bg-muted text-foreground')}
        onClick={() => setTheme('light')}
        aria-label={t('light')}
      >
        <SunIcon className='size-4' />
      </Button>

      <Button
        variant='ghost'
        size='icon'
        className={cn('size-6 cursor-pointer rounded-full px-0', theme === 'dark' && 'bg-muted text-foreground')}
        onClick={() => setTheme('dark')}
        aria-label={t('dark')}
      >
        <MoonIcon className='size-4' />
      </Button>

      <Button
        variant='ghost'
        size='icon'
        className={cn('size-6 cursor-pointer rounded-full px-0', theme === 'system' && 'bg-muted text-foreground')}
        onClick={() => setTheme('system')}
        aria-label={t('system')}
      >
        <LaptopIcon className='size-4' />
      </Button>
    </div>
  )
}
