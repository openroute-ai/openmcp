'use client'

import { Card, CardContent } from '@workspace/ui/components/card'
import { Tag } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface CategoryHeroProps {
  category: {
    slug: string
    name: string
    description?: string
    workflowCount: number
  }
}

export function CategoryHero({ category }: CategoryHeroProps) {
  const t = useTranslations('Workflows')

  return (
    <div className='mx-auto w-full max-w-7xl px-5 py-8 sm:px-6 lg:px-10'>
      <Card className='py-0'>
        <CardContent className='p-6'>
          <div className='flex flex-col items-center gap-6 md:items-start'>
            {/* Category Icon and Name */}
            <div className='flex w-full items-center gap-4'>
              <div className='flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10'>
                <Tag className='h-8 w-8 text-primary' />
              </div>
              <div className='flex-1'>
                <h1 className='mb-2 font-bold text-3xl text-foreground'>{category.name}</h1>
                {category.description && <p className='text-lg text-muted-foreground'>{category.description}</p>}
              </div>
            </div>

            {/* Workflow Count Badge */}
            <div className='inline-flex items-center rounded-full bg-primary/10 px-4 py-2 text-primary'>
              <span className='font-semibold text-lg'>{category.workflowCount}</span>
              <span className='ml-2'>{t('workflowCount', { count: category.workflowCount })}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
