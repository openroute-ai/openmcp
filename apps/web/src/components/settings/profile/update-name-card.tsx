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
import { Field, FieldError } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

interface UpdateNameCardProps {
  className?: string
}

/**
 * update user name
 */
export function UpdateNameCard({ className }: UpdateNameCardProps) {
  const t = useTranslations('Dashboard.settings.profile')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | undefined>('')
  const { data: session, refetch } = authClient.useSession()

  // Create a schema for name validation
  const formSchema = z.object({
    name: z
      .string()
      .min(3, { message: t('name.minLength') })
      .max(30, { message: t('name.maxLength') }),
  })

  // Initialize the form with empty string as fallback if user.name is undefined
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: session?.user?.name || '',
    },
  })

  useEffect(() => {
    if (session?.user?.name) {
      form.setValue('name', session.user.name)
    }
  }, [session, form])

  // Check if user exists after all hooks are initialized
  const user = session?.user
  if (!user) {
    return null
  }

  // Handle form submission
  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    // Don't update if the name hasn't changed
    if (values.name === session?.user?.name) {
      console.log('No changes to save')
      return
    }

    await authClient.updateUser(
      {
        name: values.name,
      },
      {
        onRequest: (ctx) => {
          // console.log('update name, request:', ctx.url);
          setIsSaving(true)
          setError('')
        },
        onResponse: (ctx) => {
          // console.log('update name, response:', ctx.response);
          setIsSaving(false)
        },
        onSuccess: (ctx) => {
          // update name success, user information stored in ctx.data
          // console.log("update name, success:", ctx.data);
          toast.success(t('name.success'))
          refetch()
          form.reset()
        },
        onError: (ctx) => {
          // update name fail, display the error message
          console.error('update name error:', ctx.error)
          setError(`${ctx.error.status}: ${ctx.error.message}`)
          toast.error(t('name.fail'))
        },
      }
    )
  }

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden pt-6 pb-0 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('name.title')}</CardTitle>
        <CardDescription>{t('name.description')}</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} className='flex flex-1 flex-col'>
        <CardContent className='flex-1 space-y-4'>
          <Controller
            control={form.control}
            name='name'
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <Input
                  placeholder={t('name.placeholder')}
                  aria-invalid={fieldState.invalid}
                  {...field}
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <FormError message={error} />
        </CardContent>
        <CardFooter className='mt-6 flex items-center justify-between rounded-none bg-background px-6 py-4'>
          <p className='text-muted-foreground text-sm'>{t('name.hint')}</p>

          <Button type='submit' disabled={isSaving} className='cursor-pointer'>
            {isSaving ? t('name.saving') : t('name.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
