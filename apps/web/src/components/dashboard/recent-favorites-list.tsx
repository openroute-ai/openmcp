'use client'

import { format } from 'date-fns'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'

export interface RecentFavorite {
  id: string
  workflowId: string
  createdAt: Date | string
  workflow: {
    id: string
    title: string | null
    titleEn: string | null
    slug: string
  }
}

interface RecentFavoritesListProps {
  data?: RecentFavorite[]
  isLoading?: boolean
  error?: Error | null
}

export function RecentFavoritesList({ data, isLoading = false, error = null }: RecentFavoritesListProps) {
  const t = useTranslations('Dashboard')
  const locale = useLocale()

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('recentFavorites')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-2'>
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className='h-12 w-full' />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('recentFavorites')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='py-8 text-center text-muted-foreground'>{t('loadError')}</div>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('recentFavorites')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='py-8 text-center text-muted-foreground'>{t('noFavorites')}</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recentFavorites')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('workflowName')}</TableHead>
              <TableHead>{t('favoriteTime')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => {
              const workflowName = locale === 'zh' ? item.workflow.title : item.workflow.titleEn || item.workflow.title
              const favoriteDate = typeof item.createdAt === 'string' ? new Date(item.createdAt) : item.createdAt

              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <LocaleLink href={`/workflows/${item.workflow.slug}`} className='text-primary hover:underline'>
                      {workflowName || t('unnamedWorkflow')}
                    </LocaleLink>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{format(favoriteDate, 'yyyy-MM-dd HH:mm')}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
