'use client'

import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'

interface StatCardProps {
  /** 卡片标题，例如「本月消费」 */
  label: string
  /** 主数值，调用方负责格式化 */
  value: ReactNode
  /** 右上角动作（趋势徽章等） */
  action?: ReactNode
  /** 底部说明行（趋势文案、快捷链接等） */
  footer?: ReactNode
  isLoading?: boolean
}

/**
 * 概览页共用的 KPI 卡。
 *
 * 两种角色（消费者 / 创作者）的指标卡刻意共用同一个外壳：卡片密度、
 * 数值字号和渐变底色一致，切换角色时只有指标本身变化，不会产生
 * 「换了个页面」的割裂感。
 *
 * 紧凑版：覆盖 Card 默认的 `py-4 / gap-4` 为 `py-3 / gap-2`，并去掉
 * 内容区多余的底部留白 —— 一屏要放 4–5 张卡，行高比单卡的呼吸感更值钱。
 */
export function StatCard({ label, value, action, footer, isLoading = false }: StatCardProps) {
  if (isLoading) {
    return (
      <Card className='@container/card gap-2 py-3'>
        <CardHeader>
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-7 w-24' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-4 w-32' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className='@container/card gap-2 py-3'>
      <CardHeader className='gap-1'>
        <div className='flex w-full flex-row items-center justify-between gap-2'>
          <CardDescription>{label}</CardDescription>
          {action}
        </div>
        <CardTitle className='font-semibold @[250px]/card:text-3xl text-2xl tabular-nums'>{value}</CardTitle>
      </CardHeader>
      {footer ? (
        <CardContent className='flex flex-col items-start gap-1 text-sm'>{footer}</CardContent>
      ) : null}
    </Card>
  )
}
