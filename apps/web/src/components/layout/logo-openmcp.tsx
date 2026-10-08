import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'
import { LogoIcon } from '@/components/icons/logo'

export function OpenMcpLogo({
  className,
  alt = 'OpenMCP Hub',
  title = 'OpenMCP Hub',
}: {
  className?: string
  alt?: string
  title?: string
}) {
  return (
    <LogoIcon
      className={cn('text-primary size-8', className)}
      aria-label={alt}
      {...({ title } as SVGProps<SVGSVGElement>)}
    />
  )
}
