'use client'

import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useState } from 'react'

interface McpServersHeroProps {
  onSearch?: (search: string) => void
  totalServers?: number
  initialSearch?: string
}

export function McpServersHero({ onSearch, totalServers = 0, initialSearch = '' }: McpServersHeroProps) {
  const t = useTranslations('McpPage.hero')
  // Uncontrolled input: `key={initialSearch}` above resyncs it from the URL.
  const [value, setValue] = useState(initialSearch)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSearch?.(value)
  }

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mb-8 flex flex-col items-center gap-4 text-center'>
        <h1 className='font-bold text-foreground text-title'>{t('title')}</h1>
        <p className='max-w-3xl text-balance text-lg text-muted-foreground'>{t('subtitle')}</p>
        {totalServers > 0 && (
          <p className='font-semibold text-primary text-xl md:text-2xl'>{totalServers.toLocaleString()}</p>
        )}
        <form onSubmit={handleSubmit} className='flex w-full max-w-md items-center gap-2'>
          <div className='relative flex-1'>
            <Search className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              // Remount when the URL-driven search changes so the field
              // follows back/forward navigation without a state-sync effect.
              key={initialSearch}
              type='text'
              name='q'
              defaultValue={initialSearch}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className='pl-9'
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button type='submit'>{t('searchAction')}</Button>
        </form>
      </div>
    </div>
  )
}
