'use client'

import { useTranslations } from 'next-intl'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { formatNumber } from '@/lib/utils'

export interface TopAssetRow {
  id: string
  type: 'skill' | 'mcp' | 'a2a' | 'persona'
  title: string
  calls: number
  views: number
  downloads: number
  favorites: number
}

interface TopAssetsCardProps {
  data?: TopAssetRow[] | null
  /** 四类资产的已发布数量，渲染在表格上方的 chips 里 */
  breakdown?: {
    skills: number
    mcpServers: number
    a2aAgents: number
    personas: number
    total: number
  } | null
  isLoading?: boolean
  className?: string
}

/**
 * 资产表现 Top 5：把「卖得最多的资产」放到首页，替代原来只有计数的
 * 资产概览卡 —— 计数在 KPI 里已经出现过，表格才回答"哪个资产值得继续推"。
 */
export function TopAssetsCard({ data, breakdown, isLoading = false, className }: TopAssetsCardProps) {
  const t = useTranslations('Dashboard.creator.topAssets')
  const tProvider = useTranslations('Dashboard.providerStats')

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-3'>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className='h-8 w-full' />
          ))}
        </CardContent>
      </Card>
    )
  }

  const chips = breakdown
    ? [
        { label: tProvider('assets.skills'), count: breakdown.skills },
        { label: tProvider('assets.mcpServers'), count: breakdown.mcpServers },
        { label: tProvider('assets.a2aAgents'), count: breakdown.a2aAgents },
        { label: tProvider('assets.personas'), count: breakdown.personas },
      ]
    : []

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <LocaleLink href={Routes.MyAssetsMCP} className='text-primary text-sm hover:underline'>
            {t('viewAll')} →
          </LocaleLink>
        </CardAction>
      </CardHeader>
      <CardContent className='px-6 pb-4'>
        {chips.length > 0 && (
          <div className='mb-3 flex flex-wrap gap-2'>
            {chips.map((chip) => (
              <Badge key={chip.label} variant='outline' className='font-normal'>
                {chip.label} <span className='ml-1 font-medium tabular-nums'>{chip.count}</span>
              </Badge>
            ))}
          </div>
        )}

        {!data || data.length === 0 ? (
          <div className='py-8 text-center text-muted-foreground text-sm'>{t('empty')}</div>
        ) : (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colAsset')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead className='text-right'>{t('colCalls')}</TableHead>
                  <TableHead className='text-right'>{t('colDownloads')}</TableHead>
                  <TableHead className='text-right'>{t('colFavorites')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={`${row.type}:${row.id}`}>
                    <TableCell className='max-w-40 truncate font-medium'>{row.title}</TableCell>
                    <TableCell>
                      <Badge variant='secondary'>{t(`type.${row.type}`)}</Badge>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatNumber(row.calls, { useLocale: true })}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatNumber(row.downloads, { useLocale: true })}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatNumber(row.favorites, { useLocale: true })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
