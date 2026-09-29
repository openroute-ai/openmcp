'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { authClient } from '@/lib/auth-client'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const formSchema = z.object({
  email: z.string().email(),
})

export interface ForgotPasswordFormProps {
  className?: string
}

/** Requests a password-reset email. Mirrors the sign-in card styling. */
export function ForgotPasswordForm({ className }: ForgotPasswordFormProps) {
  const t = useTranslations('AuthPage.forgotPassword')
  const tc = useTranslations('AuthPage.common')
  const [isPending, setIsPending] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsPending(true)
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: Routes.ResetPassword,
    })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(t('checkEmail'))
    }
    setIsPending(false)
  }

  return (
    <AuthCard headerLabel={t('title')} description={t('description')} className={className}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={!!form.formState.errors.email}
                disabled={isPending}
                {...form.register('email')}
              />
              {form.formState.errors.email && <FieldError errors={[form.formState.errors.email]} />}
            </Field>
          </FieldGroup>

          <FormError message={form.formState.errors.root?.message} />

          <Button
            disabled={isPending}
            size="lg"
            type="submit"
            className="flex w-full cursor-pointer items-center justify-center gap-2"
          >
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            <span>{t('send')}</span>
          </Button>
        </div>
      </form>

      <p className="text-balance mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        {tc('byClickingContinue')}
        <LocaleLink href={Routes.TermsOfService} className="underline underline-offset-4 hover:text-primary">
          {tc('termsOfService')}
        </LocaleLink>{' '}
        {tc('and')}{' '}
        <LocaleLink href={Routes.PrivacyPolicy} className="underline underline-offset-4 hover:text-primary">
          {tc('privacyPolicy')}
        </LocaleLink>
      </p>
    </AuthCard>
  )
}
