'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { HeaderSection } from '@/components/layout/header-section'

const MAX_EMAIL_LENGTH = 254

/**
 * Centered newsletter call-to-action.
 *
 * A single-column form rather than the footer's compact one: this block sits
 * between the end of an article and the footer, where the reader is already
 * finished reading and the field is the page's only action. Writes through the
 * same mutation as the footer, so the row it produces is indistinguishable from
 * one created there.
 */
export function NewsletterCard({ className }: { className?: string }) {
  const t = useTranslations('Newsletter')
  const tForm = useTranslations('Newsletter.form')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()

  const subscribeMutation = trpc.newsletters.subscribeNewsletter.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(tForm('success'))
        setEmail('')
        setError(undefined)
      } else {
        const message = result.error || tForm('fail')
        setError(message)
        toast.error(message)
      }
    },
    onError: () => {
      setError(tForm('fail'))
      toast.error(tForm('fail'))
    },
  })

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalized = email.trim().toLowerCase()
    if (!normalized) {
      setError(tForm('emailValidation'))
      return
    }
    setError(undefined)

    subscribeMutation.mutate({ email: normalized, source: 'blog' })
  }

  return (
    <div className={cn('w-full rounded-lg bg-muted/50 p-8 lg:p-16', className)}>
      <div className="flex flex-col items-center justify-center gap-8">
        <HeaderSection
          title={t('title')}
          subtitle={t('subtitle')}
          description={t('description')}
        />

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mx-auto flex w-full max-w-md items-center"
        >
          <div className="relative w-full">
            <label htmlFor="newsletter-card-email" className="sr-only">
              {tForm('email')}
            </label>
            <Input
              id="newsletter-card-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={MAX_EMAIL_LENGTH}
              placeholder={tForm('email')}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) setError(undefined)
              }}
              aria-invalid={Boolean(error)}
              className="h-12 w-full rounded-r-none focus-visible:ring-offset-0"
            />
            {error ? (
              <p className="text-destructive absolute -bottom-6 left-0 text-sm">{error}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            disabled={subscribeMutation.isPending}
            className="size-12 shrink-0 cursor-pointer rounded-l-none"
          >
            {subscribeMutation.isPending ? (
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            ) : (
              <SendIcon className="size-6" aria-hidden="true" />
            )}
            <span className="sr-only">
              {subscribeMutation.isPending ? tForm('subscribing') : tForm('subscribe')}
            </span>
          </Button>
        </form>
      </div>
    </div>
  )
}

/** Paper-plane send glyph, matching the footer's icon-less submit button. */
function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  )
}
