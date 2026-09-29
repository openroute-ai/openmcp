'use client'

import { LogoIcon } from '@/components/icons/logo'

export function Logo({ className }: { className?: string }) {
  return (
    <LogoIcon className={className} />
    // <Image
    //   src={logo}
    //   alt="Logo"
    //   title="Logo"
    //   width={96}
    //   height={96}
    //   className={cn('size-8 rounded-md', className)}
    // />
  )
}
