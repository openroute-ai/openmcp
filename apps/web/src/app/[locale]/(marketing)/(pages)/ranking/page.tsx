'use client'

import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Button } from '@workspace/ui/components/button'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { RankingWorkflowCard } from '@/components/rankings/ranking-workflow-card'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'
import { formatDateKey, lastMonthStart, lastWeekStart } from '@/lib/ranking/dates'
import type { RankingWorkflowRow } from '@/web/workflow-rankings/types'

/**
 * Public ranking landing page.
 *
 * Shows four finished periods at once so a visitor gets a sense of both the
 * current standings and how they move. Every window is already complete when
 * this renders, which is why today's row is asked for with a one-day offset.
 */
export default function RankingPage() {
  const t = useTranslations('Rankings')
  const [dimension, setDimension] = useState<'recent' | 'popular'>('popular')

  const yesterday = formatDateKey(1)
  const twoDaysAgo = formatDateKey(2)
  const week = lastWeekStart()
  const month = lastMonthStart()

  const { data: todayData, isLoading: todayLoading } = trpc.workflowRankings.getWorkflowRankings.useQuery({
    dimension,
    period: 'daily',
    date: yesterday,
  })
  const { data: yesterdayData, isLoading: yesterdayLoading } =
    trpc.workflowRankings.getWorkflowRankings.useQuery({
      dimension,
      period: 'daily',
      date: twoDaysAgo,
    })
  const { data: lastWeekData, isLoading: weeklyLoading } = trpc.workflowRankings.getWorkflowRankings.useQuery({
    dimension,
    period: 'weekly',
    date: week,
  })
  const { data: lastMonthData, isLoading: monthlyLoading } = trpc.workflowRankings.getWorkflowRankings.useQuery({
    dimension,
    period: 'monthly',
    date: month,
  })

  const sections = [
    {
      key: 'latest',
      title: t('sections.latest'),
      data: todayData,
      isLoading: todayLoading,
      href: `/ranking/daily/${yesterday}`,
    },
    {
      key: 'previous',
      title: t('sections.previous'),
      data: yesterdayData,
      isLoading: yesterdayLoading,
      href: `/ranking/daily/${twoDaysAgo}`,
    },
    {
      key: 'lastWeek',
      title: t('sections.lastWeek'),
      data: lastWeekData,
      isLoading: weeklyLoading,
      href: `/ranking/weekly/${week}`,
    },
    {
      key: 'lastMonth',
      title: t('sections.lastMonth'),
      data: lastMonthData,
      isLoading: monthlyLoading,
      href: `/ranking/monthly/${month}`,
    },
  ]

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mb-8 flex flex-wrap items-center justify-between gap-4'>
        <h1 className='font-bold text-title'>{t('title')}</h1>

        <Tabs value={dimension} onValueChange={(value) => setDimension(value as typeof dimension)}>
          <TabsList>
            <TabsTrigger value='popular'>{t('dimensions.popular')}</TabsTrigger>
            <TabsTrigger value='recent'>{t('dimensions.recent')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {sections.map((section) => (
        <RankingSection
          key={section.key}
          title={section.title}
          rankings={(section.data?.success ? section.data.data : []) as RankingWorkflowRow[]}
          isLoading={section.isLoading}
          viewAllHref={section.href}
          dimension={dimension}
        />
      ))}
    </div>
  )
}

interface RankingSectionProps {
  title: string
  rankings: RankingWorkflowRow[]
  isLoading: boolean
  viewAllHref: string
  dimension: 'recent' | 'popular'
}

function RankingSection({ title, rankings, isLoading, viewAllHref, dimension }: RankingSectionProps) {
  const t = useTranslations('Rankings')

  return (
    <section className='mb-12'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='font-semibold text-2xl'>{title}</h2>
        <LocaleLink href={viewAllHref}>
          <Button variant='ghost' className='flex cursor-pointer items-center gap-1 text-primary'>
            {t('viewAll')}
            <ChevronRight className='h-4 w-4' />
          </Button>
        </LocaleLink>
      </div>

      <div className='space-y-4'>
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className='rounded-lg border p-4'>
              <div className='flex items-center gap-4'>
                <Skeleton className='h-12 w-12 rounded' />
                <Skeleton className='h-20 w-20 rounded-lg' />
                <div className='flex-1'>
                  <Skeleton className='mb-2 h-6 w-48' />
                  <Skeleton className='mb-2 h-4 w-full' />
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
          <div className='py-8 text-center text-muted-foreground'>{t('empty')}</div>
        )}
      </div>
    </section>
  )
}
