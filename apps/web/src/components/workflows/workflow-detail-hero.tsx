import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import type { WorkflowDetailData } from './types'
import Image from 'next/image'

interface WorkflowDetailHeroProps {
  workflow: Pick<WorkflowDetailData, 'id' | 'title' | 'imageUrl' | 'workflowJson'>
}

export function WorkflowDetailHero({ workflow }: WorkflowDetailHeroProps) {
  const t = useTranslations('Workflows')
  return (
    <div className='mb-6'>
      {/* Breadcrumb */}
      <nav aria-label='Breadcrumb' className='mb-4 sm:mb-6'>
        <ol className='flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:gap-x-2 sm:text-sm'>
          <li className='flex items-center'>
            <LocaleLink href='/' className='text-primary transition-colors hover:text-primary/80'>
              {t('detail.home')}
            </LocaleLink>
          </li>
          <li className='flex items-center'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <LocaleLink href='/workflows' className='text-primary transition-colors hover:text-primary/80'>
              {t('detail.workflows')}
            </LocaleLink>
          </li>
          <li className='hidden sm:flex min-w-0 items-center'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <span
              className='line-clamp-1 min-w-0 truncate text-muted-foreground'
              aria-current='page'
              title={workflow.title}
            >
              {workflow.title}
            </span>
          </li>
        </ol>
      </nav>

      {/* Page Title */}
      <header className='mb-6 sm:mb-10'>
        <h1 className='mb-6 text-balance text-center font-bold text-xl text-foreground sm:mb-8 sm:text-2xl md:text-3xl'>
          {workflow.title}
        </h1>

        {/* Workflow Preview */}
        <div className='mb-6 h-[300px] min-h-[300px] rounded-lg border border-border bg-card shadow-sm sm:mb-8 sm:h-[480px] md:h-[560px] md:min-h-[480px]'>
          {/* Workflow Preview Image */}
          <div className='relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-muted/30'>
            <Image
              src={workflow.imageUrl || '/assets/svg/placeholder-workflow.svg'}
              alt={workflow.title}
              fill
              className='object-cover'
              sizes='(max-width: 1024px) 100vw, 66vw'
            />
          </div>
        </div>
      </header>
    </div>
  )
}
