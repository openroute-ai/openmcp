'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export type AuthorView = 'skills' | 'workflows' | 'personas'

interface AuthorContentTypeFilterProps {
  value: AuthorView
  onChange: (value: AuthorView) => void
}

export function AuthorContentTypeFilter({ value, onChange }: AuthorContentTypeFilterProps) {
  const t = useTranslations('AuthorsPage')
  const tDetail = useTranslations('AuthorsPage.authorDetail')
  const items: { id: AuthorView; labelKey: 'tabSkills' | 'tabWorkflows' | 'tabPersonas' }[] = [
    { id: 'skills', labelKey: 'tabSkills' },
    { id: 'workflows', labelKey: 'tabWorkflows' },
    { id: 'personas', labelKey: 'tabPersonas' },
  ]

  return (
    <fieldset className='rounded-lg border border-border bg-card p-4 shadow-sm'>
      <legend className='mb-4 font-medium text-foreground text-sm'>{t('authorDetailContentTypeTitle')}</legend>
      <div className='space-y-2'>
        {items.map((item) => (
          <label
            key={item.id}
            className={cn(
              'flex cursor-pointer items-center rounded-md px-3 py-2 text-sm transition-colors',
              value === item.id
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <input
              type='radio'
              name='author-view'
              value={item.id}
              checked={value === item.id}
              onChange={() => onChange(item.id)}
              className='sr-only'
            />
            <span>{tDetail(item.labelKey)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
