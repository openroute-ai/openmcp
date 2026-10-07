'use client'

import type { ReactNode } from 'react'

type ProviderSubmitShellProps = {
  title: string
  description: string
  children: ReactNode
}

/**
 * Shared chrome for the three publish pages: sign in → verification → upload.
 */
export function ProviderSubmitShell({ title, description, children }: ProviderSubmitShellProps) {
  return (
    <div className='mx-auto w-full max-w-page px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mx-auto max-w-5xl space-y-8'>
        <div className='space-y-2'>
          <h1 className='font-bold text-3xl tracking-tight'>{title}</h1>
          <p className='text-lg text-muted-foreground'>{description}</p>
        </div>

        {children}
      </div>
    </div>
  )
}
