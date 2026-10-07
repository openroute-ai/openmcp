'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@workspace/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { SmsSliderCaptcha } from '@workspace/sms-captcha/client'
import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormError } from '@/components/shared/form-error'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

/** Mainland China mobile numbers, same rule as the phone sign-in form. */
const PHONE_REGEX = /^1[3-9]\d{9}$/

/** better-auth error codes worth a specific sentence. */
const ERROR_KEYS = ['PHONE_NUMBER_EXIST', 'INVALID_OTP', 'OTP_EXPIRED', 'TOO_MANY_ATTEMPTS'] as const
type ErrorCode = (typeof ERROR_KEYS)[number]

function isErrorCode(value: string | undefined): value is ErrorCode {
  return value !== undefined && (ERROR_KEYS as readonly string[]).includes(value)
}

interface BindPhoneCardProps {
  className?: string
}

/**
 * Bind (or change) the account phone number.
 *
 * The binding reuses the sign-in plugin's OTP flow with `updatePhoneNumber`:
 * better-auth then writes `phoneNumber` / `phoneNumberVerified` onto the
 * *current* session's user instead of signing into whichever account owns the
 * number. Sending the code still has to clear the slider captcha — the server
 * silently drops OTP requests without the `x-temp-captcha-token` header.
 */
export function BindPhoneCard({ className }: BindPhoneCardProps) {
  const t = useTranslations('Dashboard.settings.security.phone')
  const tAuth = useTranslations('AuthPage.phoneLogin')

  const { data: session, refetch } = authClient.useSession()
  const user = session?.user

  const [isSaving, setIsSaving] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [codeSent, setCodeSent] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const [error, setError] = useState<string | undefined>('')

  const formSchema = z.object({
    phoneNumber: z
      .string()
      .min(1, { message: tAuth('phoneRequired') })
      .regex(PHONE_REGEX, { message: tAuth('invalidPhone') }),
    verificationCode: z
      .string()
      .min(1, { message: tAuth('codeRequired') })
      .max(6, { message: tAuth('codeRequired') }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { phoneNumber: '', verificationCode: '' },
  })

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  const phone = (user as { phoneNumber?: string | null } | undefined)?.phoneNumber
  const phoneVerified = (user as { phoneNumberVerified?: boolean } | undefined)?.phoneNumberVerified

  const sendVerificationCode = async (captchaToken: string) => {
    const phoneNumber = form.getValues('phoneNumber')
    if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) {
      form.setError('phoneNumber', { message: tAuth('invalidPhone') })
      return
    }

    setIsSendingCode(true)
    setError('')

    try {
      await authClient.phoneNumber.sendOtp(
        { phoneNumber },
        {
          headers: { 'x-temp-captcha-token': captchaToken },
          onSuccess: () => {
            setCodeSent(true)
            toast.success(tAuth('codeSent'))
            setCountdown(60)
            form.clearErrors('verificationCode')
            form.setFocus('verificationCode')
          },
          onError: (ctx) => {
            setError(ctx.error?.message || tAuth('sendCodeFailed'))
          },
        }
      )
    } catch {
      setError(tAuth('sendCodeFailed'))
    } finally {
      setIsSendingCode(false)
    }
  }

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSaving(true)
    setError('')
    form.clearErrors('verificationCode')

    try {
      const { error: verifyError } = await authClient.phoneNumber.verify({
        phoneNumber: values.phoneNumber,
        code: values.verificationCode,
        // Without this the endpoint signs into the account that owns the
        // number — i.e. binds nothing and swaps the user's session instead.
        updatePhoneNumber: true,
      })

      if (verifyError && verifyError.code !== 'SUCCESS') {
        const code = verifyError.code as string | undefined
        const message = isErrorCode(code)
          ? t(`errors.${code}`)
          : verifyError.message?.trim() || tAuth('verifyFailed')
        form.setError('verificationCode', { type: 'server', message })
        return
      }

      toast.success(t('success'))
      form.reset({ phoneNumber: '', verificationCode: '' })
      setCodeSent(false)
      await refetch()
    } catch {
      form.setError('verificationCode', { type: 'server', message: tAuth('verifyFailed') })
    } finally {
      setIsSaving(false)
    }
  }

  if (!user) {
    return null
  }

  const phoneNumber = form.watch('phoneNumber')
  const canSendCode = countdown === 0 && !isSendingCode

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden pt-6 pb-0 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <form onSubmit={form.handleSubmit(onSubmit)} className='flex flex-1 flex-col'>
        <CardContent className='flex-1 space-y-4'>
          <div className='rounded-md border bg-muted/40 px-3 py-2 text-sm'>
            <p className='text-muted-foreground'>{t('current')}</p>
            <p className='font-medium'>{phone || t('empty')}</p>
            {phone ? (
              <p className='mt-1 text-muted-foreground text-xs'>
                {phoneVerified ? t('verified') : t('unverified')}
              </p>
            ) : null}
          </div>

          <Controller
            control={form.control}
            name='phoneNumber'
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor='bind-phone-number'>{tAuth('phoneNumber')}</FieldLabel>
                <Input
                  {...field}
                  id='bind-phone-number'
                  type='tel'
                  inputMode='tel'
                  autoComplete='tel-national'
                  placeholder={t('placeholder')}
                  disabled={isSaving || isSendingCode}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name='verificationCode'
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor='bind-phone-code'>{tAuth('verificationCode')}</FieldLabel>
                <div className='flex items-center gap-3'>
                  <Input
                    {...field}
                    id='bind-phone-code'
                    maxLength={6}
                    inputMode='numeric'
                    autoComplete='one-time-code'
                    placeholder={tAuth('verificationCode')}
                    disabled={isSaving || isSendingCode}
                    aria-invalid={fieldState.invalid}
                    className='min-w-0 flex-1'
                    onChange={(event) => {
                      field.onChange(event)
                      if (fieldState.error?.type === 'server') form.clearErrors('verificationCode')
                    }}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    className='h-10 shrink-0 px-3'
                    disabled={!canSendCode || !phoneNumber || !PHONE_REGEX.test(phoneNumber)}
                    onClick={() => {
                      if (!phoneNumber || !PHONE_REGEX.test(phoneNumber)) {
                        form.setError('phoneNumber', { message: tAuth('invalidPhone') })
                        return
                      }
                      setCaptchaOpen(true)
                    }}
                  >
                    {isSendingCode && <Loader2Icon className='mr-2 h-4 w-4 animate-spin' />}
                    {countdown > 0 ? tAuth('countdown', { seconds: countdown }) : tAuth('sendCode')}
                  </Button>
                </div>
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          <p className='text-muted-foreground text-sm'>{t('hint')}</p>
          <FormError message={error} />
        </CardContent>

        <CardFooter className='mt-6 flex items-center justify-between rounded-none bg-background px-6 py-4'>
          <p className='text-muted-foreground text-sm'>{t('footer')}</p>
          <Button type='submit' disabled={isSaving || !codeSent} className='cursor-pointer'>
            {isSaving ? t('saving') : t('save')}
          </Button>
        </CardFooter>
      </form>

      <SmsSliderCaptcha
        open={captchaOpen}
        onOpenChange={setCaptchaOpen}
        i18n={{
          title: tAuth('captchaTitle'),
          hint: tAuth('captchaHint'),
          loading: tAuth('captchaLoading'),
          verifying: tAuth('captchaVerifying'),
          codeSent: tAuth('codeSent'),
          challengeFailed: tAuth('captchaChallengeFailed'),
          verifyFailed: tAuth('captchaVerifyFailed'),
          mismatch: tAuth('captchaMismatch'),
          tooManyAttempts: tAuth('captchaTooManyAttempts'),
        }}
        onVerified={(token) => {
          void sendVerificationCode(token)
        }}
      />
    </Card>
  )
}
