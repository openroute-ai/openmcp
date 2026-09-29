import { Calendar, Download, Eye, Sparkles, User } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Badge } from '@workspace/ui/components/badge'
import { LocaleLink } from '@/i18n/navigation'
import type { WorkflowCardData } from './types'

interface WorkflowCardProps {
  workflow: WorkflowCardData
}

export function WorkflowCard({ workflow }: WorkflowCardProps) {
  const t = useTranslations('Workflows')

  // Keyed off the raw complexity level, not the localized display text.
  const complexityColors: Record<'beginner' | 'intermediate' | 'advanced', string> = {
    beginner: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    intermediate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    advanced: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  }

  const complexityColor = complexityColors[workflow.complexityKey]

  return (
    <LocaleLink href={`/workflows/${workflow.slug}`} className='group block h-full' prefetch={false}>
      <div className='flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-all duration-300 hover:border-primary/50 hover:shadow-md'>
        {/* Image */}
        <div className='relative aspect-video overflow-hidden bg-muted'>
          <Image
            src={workflow.imageUrl || '/assets/svg/placeholder-workflow.svg'}
            alt={workflow.title}
            fill
            className='object-cover transition-transform duration-300 group-hover:scale-105'
          />
          {/* Price Badge */}
          <span className='absolute top-2 right-2 rounded-full bg-red-500/50 px-2 py-1 font-medium text-white text-xs shadow-sm'>
            {workflow.price}
          </span>
          {/* Complexity Badge */}
          <span className={`absolute right-2 bottom-2 rounded-full px-2 py-1 text-xs shadow-sm ${complexityColor}`}>
            {workflow.complexity}
          </span>
        </div>

        {/* Content */}
        <div className='flex flex-1 flex-col p-4'>
          <div className='mb-2'>
            <h3 className='line-clamp-2 break-words font-bold text-card-foreground text-lg transition-colors group-hover:text-primary'>
              {workflow.title}
            </h3>
          </div>
          <p className='mb-4 line-clamp-2 flex-1 text-muted-foreground text-sm'>{workflow.description}</p>

          {/* Metadata Section */}
          <div className='mt-auto border-border border-t pt-2'>
            {/* Author and Categories */}
            <div className='mt-2 mb-2 flex items-center justify-center gap-4'>
              <div className='flex items-center text-muted-foreground text-xs'>
                <User className='mr-1.5 h-3.5 w-3.5 text-primary' />
                <span>{workflow.author}</span>
              </div>

              <div className='flex flex-wrap gap-1.5'>
                {workflow.categories.slice(0, 2).map((category, index) => (
                  <Badge key={index} variant='secondary' className='text-xs'>
                    {category}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className='mt-2 flex items-center justify-center gap-6 text-muted-foreground text-xs'>
              {/* Certified Badge */}
              {workflow.certified && (
                <div className='flex items-center text-accent'>
                  <Sparkles className='mr-1 h-3.5 w-3.5' />
                  <span>{t('certified')}</span>
                </div>
              )}

              {/* Date */}
              <div className='flex items-center'>
                <Calendar className='mr-1.5 h-3.5 w-3.5 text-primary' />
                <span>{workflow.date}</span>
              </div>

              {/* Views */}
              <div className='flex items-center'>
                <Eye className='mr-1.5 h-3.5 w-3.5 text-primary' />
                <span>{workflow.views}</span>
              </div>

              {/* Downloads */}
              <div className='flex items-center'>
                <Download className='mr-1.5 h-3.5 w-3.5 text-primary' />
                <span>{workflow.downloads}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LocaleLink>
  )
}
