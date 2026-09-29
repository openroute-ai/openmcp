'use client'

import { useTranslations } from 'next-intl'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { websiteConfig } from '@/lib/config/website'
import { useThemeConfig } from './active-theme-provider'

/**
 * 1. Lets the user pick the site theme.
 * 2. The theme set matches the shadcn dashboard example.
 * https://github.com/shadcn-ui/ui/blob/main/apps/v4/app/(examples)/dashboard/theme.css
 */
export function ThemeSelector() {
  if (!websiteConfig.metadata.theme?.enableSwitch) {
    return null
  }

  const { activeTheme, setActiveTheme } = useThemeConfig()
  const t = useTranslations('Common.theme')

  const DEFAULT_THEMES = [
    {
      name: t('default'),
      value: 'default',
    },
    {
      name: t('neutral'),
      value: 'neutral',
    },
    {
      name: t('blue'),
      value: 'blue',
    },
    {
      name: t('green'),
      value: 'green',
    },
    {
      name: t('amber'),
      value: 'amber',
    },
  ]

  return (
    <div className='flex items-center gap-2'>
      <Label htmlFor='theme-selector' className='sr-only'>
        {t('label')}
      </Label>
      <Select value={activeTheme} onValueChange={setActiveTheme}>
        <SelectTrigger
          id='theme-selector'
          size='sm'
          className='cursor-pointer justify-start *:data-[slot=select-value]:w-12'
        >
          <SelectValue placeholder={t('label')} />
        </SelectTrigger>
        <SelectContent align='end'>
          <SelectGroup>
            {DEFAULT_THEMES.map((theme) => (
              <SelectItem key={theme.name} value={theme.value} className='cursor-pointer'>
                {theme.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
