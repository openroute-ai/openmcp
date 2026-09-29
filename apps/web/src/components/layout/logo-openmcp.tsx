import Image from 'next/image'
import { cn } from '@/lib/utils'

export function OpenMcpLogo({
  className,
  alt = 'OpenMCP',
  title = 'OpenMCP',
}: {
  className?: string
  alt?: string
  title?: string
}) {
  return (
    <Image
      src='/logo.svg'
      alt={alt}
      title={title}
      width={96}
      height={96}
      className={cn('size-8 rounded-md', className)}
    />
  )
}
