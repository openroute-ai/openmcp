'use client'

import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group'
import { LocaleLink } from '@/i18n/navigation'
import type { Category } from '@/lib/blog/types'
import { cn } from '@/lib/utils'

export type BlogCategoryListDesktopProps = {
  categoryList: Category[]
}

export function BlogCategoryListDesktop({ categoryList }: BlogCategoryListDesktopProps) {
  const { slug } = useParams() as { slug?: string }
  const t = useTranslations('BlogPage')

  return (
    <div className='flex items-center justify-center'>
      <ToggleGroup
        size='sm'
        type='single'
        value={slug || 'All'}
        aria-label='Toggle blog category'
        className='h-9 space-x-1 overflow-hidden rounded-md border bg-background p-1 *:h-7 *:text-muted-foreground'
      >
        <ToggleGroupItem
          key='All'
          value='All'
          className={cn(
            'cursor-pointer rounded-sm px-2',
            'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
            'hover:bg-accent hover:text-accent-foreground'
          )}
          aria-label={'Toggle all blog categories'}
        >
          <LocaleLink href={'/blog'} className='px-4'>
            <h2>{t('all')}</h2>
          </LocaleLink>
        </ToggleGroupItem>

        {categoryList.map((category, index) => (
          <ToggleGroupItem
            key={category.slug + index}
            value={category.slug}
            className={cn(
              'cursor-pointer rounded-sm px-2',
              'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
              'hover:bg-accent hover:text-accent-foreground'
            )}
            aria-label={`Toggle blog category of ${category.name}`}
          >
            <LocaleLink href={`/blog/category/${category.slug}`} className='px-4'>
              <h2>{category.name}</h2>
            </LocaleLink>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
