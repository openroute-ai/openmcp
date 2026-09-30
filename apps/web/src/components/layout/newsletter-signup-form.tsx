'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'

const MAX_EMAIL_LENGTH = 254

interface NewsletterSignupFormProps {
  className?: string
}

/**
 * Anonymous newsletter signup for the marketing pages.
 *
 * The list is keyed by address, so this needs no account — requiring one would
 * drop every visitor who has not signed up yet, which is most of the traffic
 * this form is aimed at. A visitor who *is* signed in still gets their row
 * linked to their user, handled server-side from the session.
 */
export function NewsletterSignupForm({ className }: NewsletterSignupFormProps) {
  const t = useTranslations('Marketing.footer.newsletter')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const lastSubmission = useRef<{ email: string; at: number } | null>(null)

  const subscribeMutation = trpc.newsletters.subscribeNewsletter.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('success'))
        setEmail('')
        setError(undefined)
      } else {
        const message = result.error || t('error')
        setError(message)
        toast.error(message)
      }
    },
    onError: () => {
      setError(t('error'))
      toast.error(t('error'))
    },
  })

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalized = email.trim().toLowerCase()
    if (!normalized) {
      setError(t('emailRequired'))
      return
    }
    setError(undefined)

    // Client-side throttle for accidental double submits. Not a security
    // control — the same endpoint is reachable directly regardless.
    const now = Date.now()
    if (lastSubmission.current?.email === normalized && now - lastSubmission.current.at < 3000) {
      return
    }
    lastSubmission.current = { email: normalized, at: now }

    // Attribution is read from the landing URL and the document referrer, so
    // the form itself does not have to thread it through props.
    const params = new URLSearchParams(window.location.search)
    const attribution = {
      email: normalized,
      source: 'website',
      utmSource: params.get('utm_source') ?? undefined,
      utmMedium: params.get('utm_medium') ?? undefined,
      utmCampaign: params.get('utm_campaign') ?? undefined,
      utmTerm: params.get('utm_term') ?? undefined,
      utmContent: params.get('utm_content') ?? undefined,
      referrer: document.referrer ? document.referrer.slice(0, 512) : undefined,
    }

    subscribeMutation.mutate(attribution)
  }

  return (
    <form className={cn('space-y-2', className)} onSubmit={handleSubmit} noValidate>
      <label htmlFor='newsletter-email' className='text-sm font-medium'>
        {t('title')}
      </label>
      <p className='text-muted-foreground text-sm'>{t('description')}</p>
      <div className='flex gap-2'>
        <Input
          id='newsletter-email'
          type='email'
          inputMode='email'
          autoComplete='email'
          maxLength={MAX_EMAIL_LENGTH}
          placeholder={t('placeholder')}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            if (error) setError(undefined)
          }}
          aria-invalid={Boolean(error)}
          className='min-w-0 flex-1'
        />
        <Button type='submit' disabled={subscribeMutation.isPending} className='shrink-0 cursor-pointer'>
          {subscribeMutation.isPending && <Loader2 className='mr-2 size-4 animate-spin' />}
          {subscribeMutation.isPending ? t('submitting') : t('submit')}
        </Button>
      </div>
      {error ? <p className='text-destructive text-sm'>{error}</p> : null}
    </form>
  )
}
