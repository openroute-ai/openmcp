'use client'

import { ArrowLeft, CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { RankingWorkflowCard } from '@/components/rankings/ranking-workflow-card'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'
import { alignPeriodKey, formatDateKey, shiftPeriod, type RankingPeriod } from '@/lib/ranking/dates'
import { cn } from '@/lib/utils'
import type { RankingWorkflowRow } from '@/web/workflow-rankings/types'

const PERIODS: RankingPeriod[] = ['daily', 'weekly', 'monthly']
const PAGE_SIZE = 20

const isPeriod = (value: string): value is RankingPeriod => PERIODS.includes(value as RankingPeriod)

const isDateKey = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * One period's full ranking, with stepper navigation.
 *
 * Period and date live in the URL so a particular week can be linked and the
 * back button walks history. An unrecognised segment falls back to today's date
 * rather than erroring; a requested window the cron has not written yet simply
 * renders empty.
 *
 * The period and the date are kept in the same `href` as a single
 * `LocaleLink` rather than a `router.push`. A raw `push('/ranking/...')` drops
 * the active locale segment, so switching weeks in the Chinese UI would bounce
 * the visitor to the default-language site and reset the toggle.
 */
export default function RankingDetailPage() {
  const t = useTranslations('Rankings')
  const params = useParams<{ period: string; date: string }>()

  const period: RankingPeriod = isPeriod(params.period) ? params.period : 'daily'
  // A malformed or off-anchor URL is snapped back onto this period's canonical
  // anchor, so the key always matches the snapshot the cron wrote.
  const date = alignPeriodKey(period, isDateKey(params.date) ? params.date : formatDateKey())

  const [dimension, setDimension] = useState<'recent' | 'popular'>('popular')
  const [page, setPage] = useState(1)

  const { data, isLoading } = trpc.workflowRankings.getWorkflowRankings.useQuery({
    dimension,
    period,
    date,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  })

  const rankings = (data?.success ? data.data : []) as RankingWorkflowRow[]

  // Each stepper target is a plain link rather than a state change, so the
  // whole control set stays keyboard- and middle-click-navigable.
  const hrefFor = (nextPeriod: RankingPeriod, nextDate: string) => `/ranking/${nextPeriod}/${nextDate}`

  const hasNextPage = rankings.length === PAGE_SIZE

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-4'>
        <LocaleLink href='/ranking'>
          <Button variant='ghost' className='cursor-pointer gap-1 text-muted-foreground'>
            <ArrowLeft className='h-4 w-4' />
            {t('backToRankings')}
          </Button>
        </LocaleLink>

        <Tabs
          value={dimension}
          onValueChange={(value) => {
            setDimension(value as typeof dimension)
            setPage(1)
          }}
        >
          <TabsList>
            <TabsTrigger value='popular'>{t('dimensions.popular')}</TabsTrigger>
            <TabsTrigger value='recent'>{t('dimensions.recent')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className='mb-8 flex flex-wrap items-center justify-between gap-4'>
        <h1 className='font-bold text-title'>{t(`periods.${period}`)}</h1>

        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex items-center gap-1'>
            {PERIODS.map((value) => (
              <LocaleLink
                key={value}
                href={hrefFor(value, shiftPeriod(value, date, 0))}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-sm transition-colors',
                  value === period
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
                aria-current={value === period ? 'page' : undefined}
              >
                {t(`periods.${value}`)}
              </LocaleLink>
            ))}
          </div>

          <div className='flex items-center gap-1'>
            <LocaleLink
              href={hrefFor(period, shiftPeriod(period, date, -1))}
              aria-label={t('navigation.previous')}
              className='inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input hover:bg-accent hover:text-accent-foreground'
            >
              <ChevronLeft className='h-4 w-4' />
            </LocaleLink>
            <span className='flex items-center gap-1.5 px-1 text-sm tabular-nums'>
              <CalendarIcon className='h-4 w-4 text-muted-foreground' />
              {date}
            </span>
            <LocaleLink
              href={hrefFor(period, shiftPeriod(period, date, 1))}
              aria-label={t('navigation.next')}
              className='inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-input hover:bg-accent hover:text-accent-foreground'
            >
              <ChevronRight className='h-4 w-4' />
            </LocaleLink>
          </div>
        </div>
      </div>

      <div className='space-y-4'>
        {isLoading ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className='rounded-lg border p-4'>
              <div className='flex items-center gap-4'>
                <Skeleton className='h-12 w-12 rounded' />
                <Skeleton className='h-20 w-20 rounded-lg' />
                <div className='flex-1'>
                  <Skeleton className='mb-2 h-6 w-48' />
                  <Skeleton className='h-4 w-2/3' />
                </div>
              </div>
            </div>
          ))
        ) : rankings.length > 0 ? (
          rankings.map((ranking) => (
            <RankingWorkflowCard key={ranking.id} ranking={ranking} dimension={dimension} />
          ))
        ) : (
          <div className='py-16 text-center text-muted-foreground'>{t('empty')}</div>
        )}
      </div>

      {page > 1 || hasNextPage ? (
        <div className='mt-8 flex items-center justify-center gap-3'>
          <Button
            variant='outline'
            className='cursor-pointer'
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            <ChevronLeft className='h-4 w-4' />
            {t('pagination.previous')}
          </Button>
          <span className='text-muted-foreground text-sm tabular-nums'>{page}</span>
          <Button
            variant='outline'
            className='cursor-pointer'
            disabled={!hasNextPage}
            onClick={() => setPage((current) => current + 1)}
          >
            {t('pagination.next')}
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
