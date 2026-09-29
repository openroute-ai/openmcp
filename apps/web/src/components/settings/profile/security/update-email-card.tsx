'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormError } from '@/components/shared/form-error'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

interface UpdateEmailCardProps {
  className?: string
}

/**
 * Bind or change the account email via better-auth changeEmail.
 * Unverified / phone-only accounts can update without prior verification;
 * verified accounts receive a confirmation email.
 */
export function UpdateEmailCard({ className }: UpdateEmailCardProps) {
  const t = useTranslations('Dashboard.settings.security.email')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | undefined>('')
  const { data: session, refetch } = authClient.useSession()

  const formSchema = z.object({
    newEmail: z.string().email({ message: t('invalid') }),
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      newEmail: '',
    },
  })

  useEffect(() => {
    if (session?.user?.email) {
      form.setValue('newEmail', session.user.email)
    }
  }, [session, form])

  const user = session?.user
  if (!user) {
    return null
  }

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (values.newEmail.toLowerCase() === (session?.user?.email || '').toLowerCase()) {
      toast.message(t('unchanged'))
      return
    }

    setIsSaving(true)
    setError('')
    try {
      const result = await authClient.changeEmail({
        newEmail: values.newEmail,
        callbackURL: Routes.SettingsProfile,
      })
      if (result.error) {
        setError(result.error.message || t('fail'))
        toast.error(t('fail'))
        return
      }
      toast.success(session?.user?.emailVerified ? t('verifySent') : t('success'))
      await refetch()
    } catch (err) {
      console.error('change email error:', err)
      setError(t('fail'))
      toast.error(t('fail'))
    } finally {
      setIsSaving(false)
    }
  }

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
              <p className='font-medium'>{user.email || t('empty')}</p>
              <p className='mt-1 text-muted-foreground text-xs'>
                {user.emailVerified ? t('verified') : t('unverified')}
              </p>
            </div>
            <Controller
              control={form.control}
              name='newEmail'
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>{t('newEmail')}</FieldLabel>
                    <Input type='email' placeholder={t('placeholder')} autoComplete='email' {...field} />
{fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <p className='text-muted-foreground text-sm'>{t('hint')}</p>
            <FormError message={error} />
          </CardContent>
          <CardFooter className='mt-6 flex items-center justify-between rounded-none bg-background px-6 py-4'>
            <p className='text-muted-foreground text-sm'>{t('footer')}</p>
            <Button type='submit' disabled={isSaving} className='cursor-pointer'>
              {isSaving ? t('saving') : t('save')}
            </Button>
          </CardFooter>
        </form>
      
    </Card>
  )
}
