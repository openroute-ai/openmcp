'use client'

import { cn } from '@/lib/utils'
import { LogoIcon } from '@/components/icons/logo'

export function Logo({ className }: { className?: string }) {
  return <LogoIcon className={cn('text-primary', className)} />
}
