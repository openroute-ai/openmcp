import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

type SectionHeadingAlign = 'center' | 'left'

interface SectionHeadingProps {
  eyebrow?: string
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  align?: SectionHeadingAlign
  className?: string
  /** 标题层级，默认 h2；Hero 用 h1 时覆盖 */
  as?: 'h1' | 'h2'
  titleClassName?: string
}

/**
 * 落地页统一的 section 头部（eyebrow + 标题 + 描述）。
 * 收敛这些结构是为了让各 section 之间的标题样式与间距节奏保持一致。
 */
export function SectionHeading({
  eyebrow,
  icon,
  title,
  description,
  align = 'left',
  className,
  as: Title = 'h2',
  titleClassName,
}: SectionHeadingProps) {
  const centered = align === 'center'

  return (
    <div className={cn(centered && 'mx-auto max-w-3xl text-center', className)}>
      {eyebrow ? (
        <span
          className={cn(
            'mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground'
          )}
        >
          {icon}
          {eyebrow}
        </span>
      ) : null}
      <Title
        className={cn(
          'mb-4 text-4xl font-medium tracking-tight text-balance text-foreground',
          titleClassName
        )}
      >
        {title}
      </Title>
      {description ? (
        <p className="text-xl leading-relaxed text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  )
}
