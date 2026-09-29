'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormError } from '@/components/shared/form-error'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { useLocaleRouter } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

interface UpdatePasswordCardProps {
  className?: string
}

/**
 * Update user password
 *
 * This component allows users to update their password.
 *
 * NOTE: This should only be used for users with credential providers (email/password login).
 * For conditional rendering based on provider type, use ConditionalUpdatePasswordCard instead.
 *
 * @see ConditionalUpdatePasswordCard
 * @see https://www.better-auth.com/docs/authentication/email-password#update-password
 */
export function UpdatePasswordCard({ className }: UpdatePasswordCardProps) {
  const t = useTranslations('Dashboard.settings.security.updatePassword')
  const [isSaving, setIsSaving] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [error, setError] = useState<string | undefined>('')
  const router = useLocaleRouter()
  const { data: session } = authClient.useSession()

  // Create a schema for password validation
  const formSchema = z.object({
    currentPassword: z.string().min(1, { message: t('currentRequired') }),
    newPassword: z.string().min(8, { message: t('newMinLength') }),
  })

  // Initialize the form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
    },
  })

  // Check if user exists after all hooks are initialized
  const user = session?.user
  if (!user) {
    return null
  }

  // Handle form submission
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    await authClient.changePassword(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        revokeOtherSessions: true,
      },
      {
        onRequest: (ctx) => {
          // console.log('update password, request:', ctx.url);
          setIsSaving(true)
          setError('')
        },
        onResponse: (ctx) => {
          // console.log('update password, response:', ctx.response);
          setIsSaving(false)
        },
        onSuccess: (ctx) => {
          // update password success, user information stored in ctx.data
          // console.log("update password, success:", ctx.data);
          toast.success(t('success'))
          router.refresh()
          form.reset()
        },
        onError: (ctx) => {
          // update password fail, display the error message
          // { "message": "Invalid password", "code": "INVALID_PASSWORD", "status": 400, "statusText": "BAD_REQUEST" }
          console.error('update password error:', ctx.error)
          setError(`${ctx.error.status}: ${ctx.error.message}`)
          toast.error(t('fail'))
        },
      }
    )
  }

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden pt-6 pb-0 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      
        <form onSubmit={form.handleSubmit(onSubmit)} className='flex flex-1 flex-col'>
          <CardContent className='flex-1 space-y-4'>
            <Controller
              control={form.control}
              name='currentPassword'
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>{t('currentPassword')}</FieldLabel>
                    <div className='relative'>
                      <Input
                        type={showCurrentPassword ? 'text' : 'password'}
                        placeholder={t('currentPassword')}
                        {...field}
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='absolute top-0 right-0 h-full px-3 py-2 hover:bg-transparent'
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      >
                        {showCurrentPassword ? <EyeOffIcon className='h-4 w-4' /> : <EyeIcon className='h-4 w-4' />}
                        <span className='sr-only'>{showCurrentPassword ? t('hidePassword') : t('showPassword')}</span>
                      </Button>
                    </div>
{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name='newPassword'
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>{t('newPassword')}</FieldLabel>
                    <div className='relative'>
                      <Input type={showNewPassword ? 'text' : 'password'} placeholder={t('newPassword')} {...field} />
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='absolute top-0 right-0 h-full cursor-pointer px-3 py-2 hover:bg-transparent'
                        onClick={() => setShowNewPassword(!showNewPassword)}
                      >
                        {showNewPassword ? <EyeOffIcon className='size-4' /> : <EyeIcon className='size-4' />}
                        <span className='sr-only'>{showNewPassword ? t('hidePassword') : t('showPassword')}</span>
                      </Button>
                    </div>
{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <FormError message={error} />
          </CardContent>
          <CardFooter className='mt-6 flex items-center justify-between rounded-none bg-background px-6 py-4'>
            <p className='text-muted-foreground text-sm'>{t('hint')}</p>

            <Button type='submit' disabled={isSaving} className='cursor-pointer'>
              {isSaving ? t('saving') : t('save')}
            </Button>
          </CardFooter>
        </form>
      
    </Card>
  )
}
