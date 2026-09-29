'use client'

import { Button } from '@workspace/ui/components/button'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { SmsSliderCaptcha } from '@workspace/sms-captcha/client'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { useAuthStore } from '@/lib/stores/auth-store'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, SmartphoneIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useEffect, useId, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import * as z from 'zod'
import { AuthCard } from '@/components/auth/auth-card'
import { FormError } from '@/components/auth/form-error'
import { FormSuccess } from '@/components/auth/form-success'
import { safeCallbackUrl } from '@/lib/auth/redirect'

/** Mainland China mobile numbers. */
const PHONE_REGEX = /^1[3-9]\d{9}$/

export interface PhoneLoginFormProps {
  className?: string
}

/**
 * Phone sign-in: request an SMS code, then verify it.
 *
 * Sending a code is gated behind the slider captcha — the challenge is opened
 * on click, and its one-shot token is forwarded to better-auth as
 * `x-temp-captcha-token`, which the server validates before dispatching.
 */
export function PhoneLoginForm({ className }: PhoneLoginFormProps) {
  const t = useTranslations('AuthPage.phoneLogin')
  const searchParams = useSearchParams()
  const callbackUrl = safeCallbackUrl(searchParams.get('callbackUrl'), Routes.Dashboard)
  const { setAuthMode } = useAuthStore()
  const [error, setError] = useState<string | undefined>('')
  const [success, setSuccess] = useState<string | undefined>('')
  const [isPending, setIsPending] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [codeSent, setCodeSent] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const formId = useId()

  const phoneLoginSchema = useMemo(
    () =>
      z.object({
        phoneNumber: z
          .string()
          .min(1, { message: t('phoneRequired') })
          .regex(PHONE_REGEX, { message: t('invalidPhone') }),
        verificationCode: z
          .string()
          .min(1, { message: t('codeRequired') })
          .max(6, { message: t('codeRequired') }),
      }),
    [t]
  )

  const form = useForm<z.infer<typeof phoneLoginSchema>>({
    resolver: zodResolver(phoneLoginSchema),
    defaultValues: { phoneNumber: '', verificationCode: '' },
  })

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const sendVerificationCode = async (captchaToken?: string) => {
    const phoneNumber = form.getValues('phoneNumber')
    if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) {
      form.setError('phoneNumber', { message: t('invalidPhone') })
      return
    }

    setIsSendingCode(true)
    setError('')

    try {
      await authClient.phoneNumber.sendOtp(
        { phoneNumber },
        {
          headers:
            captchaToken != null ? { 'x-temp-captcha-token': captchaToken } : undefined,
          onRequest: () => setIsSendingCode(true),
          onResponse: () => setIsSendingCode(false),
          onSuccess: () => {
            setCodeSent(true)
            setSuccess(t('codeSent'))
            setCountdown(60)
            form.clearErrors('verificationCode')
            form.setFocus('verificationCode')
          },
          onError: (ctx) => {
            const msg =
              ctx.error?.message ??
              `${ctx.error?.status ?? ''}: ${String(ctx.error?.message ?? '')}`
            setError(msg || t('sendCodeFailed'))
          },
        }
      )
    } catch {
      setError(t('sendCodeFailed'))
      setIsSendingCode(false)
    }
  }

  const onSubmit = async (values: z.infer<typeof phoneLoginSchema>) => {
    setIsPending(true)
    setError('')
    setSuccess('')
    form.clearErrors('verificationCode')

    try {
      const { error } = await authClient.phoneNumber.verify({
        phoneNumber: values.phoneNumber,
        code: values.verificationCode,
      })

      if (error && error?.code !== 'SUCCESS') {
        form.setError('verificationCode', {
          type: 'server',
          message: error?.message?.trim() || t('verifyFailed'),
        })
      } else {
        toast.success(t('verifySuccess'))
        // A full navigation is required: the session cookie is set by the
        // verify response, and a client-side route change would render the
        // dashboard before the server sees that cookie.
        window.location.assign(callbackUrl)
      }
    } catch {
      form.setError('verificationCode', {
        type: 'server',
        message: t('verifyFailed'),
      })
    } finally {
      setIsPending(false)
    }
  }

  const canSendCode = countdown === 0 && !isSendingCode
  const phoneNumber = form.watch('phoneNumber')

  return (
    <AuthCard
      headerLabel={t('welcomeBack')}
      description={t('description')}
      className={className}
    >
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-2 p-2">
        <FieldGroup className="gap-4">
          <Controller
            name="phoneNumber"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-phone`}>{t('phoneNumber')}</FieldLabel>
                <div className="relative">
                  <Input
                    {...field}
                    id={`${formId}-phone`}
                    disabled={isPending || isSendingCode}
                    placeholder={t('phoneNumber')}
                    type="tel"
                    className="pl-10"
                    aria-invalid={fieldState.invalid}
                    autoComplete="tel-national"
                  />
                  <SmartphoneIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-4 w-4 text-muted-foreground" />
                </div>
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          <Controller
            name="verificationCode"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-code`}>{t('verificationCode')}</FieldLabel>
                <div className="flex items-center gap-4">
                  <Input
                    {...field}
                    id={`${formId}-code`}
                    disabled={isPending || isSendingCode}
                    placeholder={t('verificationCode')}
                    type="text"
                    maxLength={6}
                    inputMode="numeric"
                    aria-invalid={fieldState.invalid}
                    autoComplete="one-time-code"
                    className="min-w-0 flex-1"
                    onChange={(e) => {
                      field.onChange(e)
                      if (fieldState.error?.type === 'server') {
                        form.clearErrors('verificationCode')
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canSendCode || !phoneNumber || !PHONE_REGEX.test(phoneNumber)}
                    onClick={() => {
                      if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) {
                        form.setError('phoneNumber', { message: t('invalidPhone') })
                        return
                      }
                      setCaptchaOpen(true)
                    }}
                    className="h-10 shrink-0 px-3"
                  >
                    {isSendingCode && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                    {countdown > 0 ? t('countdown', { seconds: countdown }) : t('sendCode')}
                  </Button>
                </div>
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </FieldGroup>

        <FormError message={error || undefined} />
        <FormSuccess message={success} />

        <Button
          disabled={isPending || !codeSent}
          size="lg"
          type="submit"
          className="flex w-full cursor-pointer items-center justify-center gap-2"
        >
          {isPending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
          <span>{t('signIn')}</span>
        </Button>
      </form>

      <SmsSliderCaptcha
        open={captchaOpen}
        onOpenChange={setCaptchaOpen}
        i18n={{
          title: t('captchaTitle'),
          hint: t('captchaHint'),
          loading: t('captchaLoading'),
          verifying: t('captchaVerifying'),
          codeSent: t('codeSent'),
          challengeFailed: t('captchaChallengeFailed'),
          verifyFailed: t('captchaVerifyFailed'),
          mismatch: t('captchaMismatch'),
          tooManyAttempts: t('captchaTooManyAttempts'),
        }}
        onVerified={(token) => {
          void sendVerificationCode(token)
        }}
      />

      <div className="mt-4 text-center">
        <Button
          variant="link"
          className="text-muted-foreground text-sm hover:text-primary"
          onClick={() => setAuthMode('email')}
        >
          {t('switchToEmail')}
        </Button>
      </div>
    </AuthCard>
  )
}
