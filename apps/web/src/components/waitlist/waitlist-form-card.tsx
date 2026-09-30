'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormError } from '@/components/shared/form-error'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/shared/form'
import { Input } from '@workspace/ui/components/input'
import { trpc } from '@/lib/trpc/client'

/**
 * Waitlist form card component
 * This is a client component that handles the waitlist form submission
 */
export function WaitlistFormCard() {
  const t = useTranslations('WaitlistPage.form')
  const [error, setError] = useState<string | undefined>('')

  // Create a schema for waitlist form validation
  const formSchema = z.object({
    email: z.string().email({ message: t('emailValidation') }),
  })

  // Initialize the form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
    },
  })

  // tRPC mutation for waitlist subscription
  const subscribeWaitlistMutation = trpc.newsletters.subscribeNewsletter.useMutation({
    onSuccess: (result: { success: boolean; error?: string }) => {
      if (result.success) {
        toast.success(t('success'))
        form.reset()
        setError(undefined)
      } else {
        const errorMessage = result.error || t('fail')
        setError(errorMessage)
        toast.error(errorMessage)
      }
    },
    onError: (error) => {
      console.error('Form submission error:', error)
      const errorMessage = t('fail')
      setError(errorMessage)
      toast.error(errorMessage)
    },
  })

  // Handle form submission
  const onSubmit = (values: z.infer<typeof formSchema>) => {
    setError('')
    subscribeWaitlistMutation.mutate({ email: values.email })
  }

  return (
    <Card className='mx-auto max-w-lg overflow-hidden pt-6 pb-0'>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className='space-y-6'>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('email')}</FormLabel>
                  <FormControl>
                    <Input type='email' placeholder={t('email')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormError message={error} />
          </CardContent>
          <CardFooter className='mt-6 flex items-center justify-between rounded-none bg-muted px-6 py-4'>
            <Button type='submit' disabled={subscribeWaitlistMutation.isPending} className='cursor-pointer'>
              {subscribeWaitlistMutation.isPending ? t('subscribing') : t('subscribe')}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}
