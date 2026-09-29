'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStatesProps {
  icon?: React.ReactNode
  title?: ReactNode
  description?: string
  children?: React.ReactNode
  className?: string
}

export default function EmptyStates({
  icon,
  title = '暂无数据',
  description,
  children,
  className,
}: Partial<EmptyStatesProps>) {
  return (
    <div className={cn('flex h-full w-full items-center justify-center pb-20', className)}>
      <div className='flex w-60 flex-col justify-center gap-4'>
        <div>
          {title && <h2 className='pb-1 text-center font-semibold text-base text-black leading-relaxed'>{title}</h2>}
          {description && <p className='pb-4 text-center font-normal text-black text-sm leading-snug'>{description}</p>}
          <div className='flex justify-center gap-3'>{children}</div>
        </div>
      </div>
    </div>
  )
}
