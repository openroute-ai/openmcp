'use client'

import { CheckCircle2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

export type SubmitStep = 1 | 2 | 3

type StepDef = { step: SubmitStep; key: 'login' | 'verify' | 'upload'; href?: string }

const STEPS: readonly StepDef[] = [
  { step: 1, key: 'login' },
  { step: 2, key: 'verify', href: Routes.ProviderOnboarding },
  { step: 3, key: 'upload' },
]

type ProviderSubmitShellProps = {
  title: string
  description: string
  /** Highlighted step: 1 sign in / 2 verification / 3 upload */
  activeStep: SubmitStep
  children: ReactNode
}

/**
 * Shared chrome for the three publish pages: sign in → verification → upload.
 */
export function ProviderSubmitShell({ title, description, activeStep, children }: ProviderSubmitShellProps) {
  const t = useTranslations('ProviderPage.submit')

  return (
    <div className='pt-16'>
      <div className='mx-auto w-full max-w-page px-gutter py-12 sm:px-gutter-sm lg:px-gutter-lg'>
        <div className='mx-auto max-w-5xl space-y-8'>
          <div className='space-y-2'>
            <h1 className='font-bold text-title tracking-tight'>{title}</h1>
            <p className='text-lg text-muted-foreground'>{description}</p>
          </div>

          <nav aria-label={t('progress')} className='flex flex-wrap items-center gap-2'>
            {STEPS.map((item, index) => {
              const done = item.step < activeStep
              const current = item.step === activeStep
              const unfinished = item.step > activeStep
              const pill = (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-sm transition-colors',
                    done || current ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                    unfinished && item.href && 'hover:bg-primary/5 hover:text-primary'
                  )}
                >
                  {done ? (
                    <CheckCircle2 className='size-3.5' />
                  ) : (
                    <span
                      className={cn(
                        'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                        current ? 'bg-primary text-primary-foreground' : 'border border-current'
                      )}
                    >
                      {item.step}
                    </span>
                  )}
                  {t(`steps.${item.key}`)}
                </span>
              )

              return (
                <div key={item.step} className='flex items-center gap-2'>
                  {index > 0 && <div className='mx-1 hidden h-px w-6 bg-border sm:block' aria-hidden />}
                  {unfinished && item.href ? (
                    <LocaleLink href={item.href} className='no-underline'>
                      {pill}
                    </LocaleLink>
                  ) : (
                    pill
                  )}
                </div>
              )
            })}
          </nav>

          {children}
        </div>
      </div>
    </div>
  )
}
