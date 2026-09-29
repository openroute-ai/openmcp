'use client'

import { useParams } from 'next/navigation'
import { hasLocale, type Locale, useLocale } from 'next-intl'
import { useEffect, useTransition } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { useLocalePathname, useLocaleRouter } from '@/i18n/navigation'
import { DEFAULT_LOCALE, routing } from '@/i18n/routing'
import { websiteConfig } from '@/lib/config/website'
import { useLocaleStore } from '@/lib/stores/locale-store'

/**
 * 1. LocaleSelector
 *
 * By combining useLocaleRouter with useLocalePathname, you can change the locale for the current page
 * programmatically by navigating to the same pathname, while overriding the locale.
 * Depending on if you're using the pathnames setting, you optionally have to forward params
 * to potentially resolve an internal pathname.
 *
 * https://next-intl.dev/docs/routing/navigation#userouter
 */
export default function LocaleSelector() {
  // Return null if there's only one locale available
  const showLocaleSwitch = Object.keys(websiteConfig.i18n.locales).length > 1

  const router = useLocaleRouter()
  const pathname = useLocalePathname()
  const params = useParams()
  const locale = useLocale()
  const { currentLocale, setCurrentLocale } = useLocaleStore()
  const [, startTransition] = useTransition()

  useEffect(() => {
    setCurrentLocale(locale)
  }, [locale, setCurrentLocale])

  if (!showLocaleSwitch) {
    return null
  }

  const onSelectChange = (nextLocale: Locale) => {
    setCurrentLocale(nextLocale)

    startTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript will validate that only known `params`
        // are used in combination with a given `pathname`. Since the two will
        // always match for the current route, we can skip runtime checks.
        { pathname, params },
        { locale: nextLocale }
      )
    })
  }

  const defaultLocale = DEFAULT_LOCALE as Locale
  const activeLocale: Locale = hasLocale(routing.locales, currentLocale) ? (currentLocale as Locale) : locale
  const localeData = websiteConfig.i18n.locales[activeLocale as keyof typeof websiteConfig.i18n.locales]
  const defaultLocaleData = websiteConfig.i18n.locales[defaultLocale as keyof typeof websiteConfig.i18n.locales]

  return (
    <Select defaultValue={locale} value={currentLocale} onValueChange={onSelectChange}>
      <SelectTrigger className='w-fit cursor-pointer'>
        <SelectValue
          placeholder={
            <div className='flex items-center gap-2'>
              {defaultLocaleData.flag && <span className='text-lg'>{defaultLocaleData.flag}</span>}
              <span>{defaultLocaleData.name}</span>
            </div>
          }
        >
          {localeData && (
            <div className='flex items-center gap-2'>
              {localeData.flag && <span className='text-lg'>{localeData.flag}</span>}
              <span>{localeData.name}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(websiteConfig.i18n.locales).map(([cur, data]) => (
          <SelectItem key={cur} value={cur as Locale} className='flex cursor-pointer items-center gap-2'>
            <div className='flex items-center gap-2'>
              {data.flag && <span className='text-md'>{data.flag}</span>}
              <span>{data.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
