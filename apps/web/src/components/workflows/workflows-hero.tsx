'use client'

import { Input } from '@workspace/ui/components/input'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type React from 'react'
import { useEffect, useState } from 'react'

interface WorkflowsHeroProps {
  onSearch?: (search: string) => void
  totalWorkflows?: number
  initialSearch?: string
}

export function WorkflowsHero({ onSearch, totalWorkflows = 0, initialSearch = '' }: WorkflowsHeroProps) {
  const t = useTranslations('Workflows')
  const [searchQuery, setSearchQuery] = useState(initialSearch)

  // Keep the input in sync when the URL-driven search term changes
  useEffect(() => {
    setSearchQuery(initialSearch)
  }, [initialSearch])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch?.(searchQuery)
  }

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mb-8 text-center'>
        <h1 className='mb-2 font-bold text-foreground text-title'>{t('hero.title')}</h1>
        <div className='mb-3 text-primary text-xl md:text-2xl'>
          <span className='font-semibold'>{totalWorkflows.toLocaleString()}</span>
          <span className='ml-2'>{t('hero.countSuffix')}</span>
        </div>
        <p className='text-lg text-muted-foreground'>{t('hero.subtitle')}</p>
      </div>

      {/* Search Bar */}
      <div className='mx-auto mb-8 max-w-4xl'>
        <div className='relative'>
          <form onSubmit={handleSearch} className='flex items-center'>
            <Input
              type='text'
              name='q'
              placeholder={t('hero.searchPlaceholder')}
              className='h-12 w-full bg-background pr-12 text-foreground'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type='submit'
              className='absolute inset-y-0 right-0 flex items-center pr-4 transition-colors hover:text-primary'
            >
              <Search className='h-5 w-5 text-muted-foreground' />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
