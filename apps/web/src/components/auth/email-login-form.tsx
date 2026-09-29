'use client'

import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { safeCallbackUrl } from '@/lib/auth/redirect'
import { useAuthStore } from '@/lib/stores/auth-store'
import { LocaleLink } from '@/i18n/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { EyeIcon, EyeOffIcon, Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useLocaleRouter } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import * as z from 'zod'

export interface EmailLoginFormProps {
  className?: string
}

/** Email + password sign-in, the alternative to the phone flow. */
export function EmailLoginForm({ className }: EmailLoginFormProps) {
  const t = useTranslations('AuthPage.login')
  const router = useLocaleRouter()
  const searchParams = useSearchParams()
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'), Routes.Dashboard)
  const { setAuthMode } = useAuthStore()
  const [error, setError] = useState<string | undefined>('')
  const [isPending, setIsPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, { message: t('emailRequired') })
          .email({ message: t('emailRequired') }),
        password: z.string().min(1, { message: t('passwordRequired') }),
      }),
    [t]
  )

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setIsPending(true)
    setError('')

    const { error: signInError } = await authClient.signIn.email(values)

    if (signInError) {
      setError(signInError.message ?? '')
      setIsPending(false)
      return
    }

    toast.success(t('signIn'))
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <AuthCard
      headerLabel={t('welcomeBack')}
      description={t('title')}
      className={className}
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-2 p-2">
        <FieldGroup className="gap-4">
          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
                <Input
                  {...field}
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={fieldState.invalid}
                  disabled={isPending}
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

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
                    autoComplete="current-password"
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
                    {showPassword ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </FieldGroup>

        <FormError message={error} />

        <Button
          disabled={isPending}
          size="lg"
          type="submit"
          className="flex w-full cursor-pointer items-center justify-center gap-2"
        >
          {isPending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          <span>{t('signIn')}</span>
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between text-center">
        <Button
          variant="link"
          className="text-muted-foreground text-sm hover:text-primary"
          onClick={() => setAuthMode('phone')}
        >
          {t('switchToPhone')}
        </Button>
        <LocaleLink
          href={Routes.ForgotPassword}
          className="text-muted-foreground text-sm hover:text-primary"
        >
          {t('forgotPassword')}
        </LocaleLink>
      </div>
    </AuthCard>
  )
}
