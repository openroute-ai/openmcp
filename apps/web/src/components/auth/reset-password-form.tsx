'use client'

import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { EyeIcon, EyeOffIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { authClient } from '@/lib/auth-client'
import { LocaleLink } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

const formSchema = z
  .object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'passwordsDoNotMatch',
    path: ['confirmPassword'],
  })

export interface ResetPasswordFormProps {
  className?: string
}

/**
 * Completes a password reset. Better-auth redirects here with a one-time `token`
 * query param after the user follows the emailed link.
 */
export function ResetPasswordForm({ className }: ResetPasswordFormProps) {
  const t = useTranslations('AuthPage.resetPassword')
  const tc = useTranslations('AuthPage.common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [isPending, setIsPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!token) {
      toast.error(t('missingToken'))
      return
    }
    setIsPending(true)
    const { error } = await authClient.resetPassword({ newPassword: values.password, token })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success(t('backToLogin'))
      router.push(Routes.Login)
    }
    setIsPending(false)
  }

  return (
    <AuthCard headerLabel={t('title')} description={t('description')} className={className}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col gap-6">
          <FieldGroup>
            <Controller
              name="password"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
                  <div className="relative">
                    <Input
                      {...field}
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      aria-invalid={fieldState.invalid}
                      disabled={isPending}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    >
                      {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                    </button>
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              name="confirmPassword"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="confirmPassword">{t('confirmPassword')}</FieldLabel>
                  <Input
                    {...field}
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    aria-invalid={fieldState.invalid}
                    disabled={isPending}
                  />
                  {fieldState.invalid && (
                    <FieldError
                      errors={[
                        fieldState.error?.message === 'passwordsDoNotMatch'
                          ? { message: t('passwordsDoNotMatch') }
                          : fieldState.error,
                      ]}
                    />
                  )}
                </Field>
              )}
            />
          </FieldGroup>

          <FormError message={form.formState.errors.root?.message} />

          <Button
            disabled={isPending}
            size="lg"
            type="submit"
            className="flex w-full cursor-pointer items-center justify-center gap-2"
          >
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            <span>{t('reset')}</span>
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
