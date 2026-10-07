import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 全站外框容器。
 *
 * - 最大宽度用标准档位 `max-w-7xl`（80rem，全站统一外框）
 * - 左右留白用标准档位 `px-5` / `sm:px-6` / `lg:px-10`（1.25 → 1.5 → 2.5rem），
 *   随断点递增，使导航、正文、页脚在所有页面保持同一水平对齐线
 */
export default function Container({ className, children }: { id?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10', className)}>
      {children}
    </div>
  )
}
