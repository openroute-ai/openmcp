import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 全站外框容器。
 *
 * - 最大宽度来自 `--layout-page-max`（映射为 `max-w-page`）
 * - 左右留白使用统一的 gutter 刻度，随断点递增，
 *   使导航、正文、页脚在所有页面保持同一水平对齐线
 */
export default function Container({ className, children }: { id?: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('mx-auto w-full max-w-page px-gutter sm:px-gutter-sm lg:px-gutter-lg', className)}>
      {children}
    </div>
  )
}
