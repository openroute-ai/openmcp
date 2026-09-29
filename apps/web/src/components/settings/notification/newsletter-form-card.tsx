'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormError } from '@/components/shared/form-error'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Switch } from '@workspace/ui/components/switch'
import { authClient } from '@/lib/auth-client'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'

interface NewsletterFormCardProps {
  className?: string
}

/**
 * Newsletter subscription form card
 *
 * Allows users to toggle their newsletter subscription status
 */
export function NewsletterFormCard({ className }: NewsletterFormCardProps) {
  const t = useTranslations('Dashboard.settings.notification')
  const [error, setError] = useState<string | undefined>('')
  const [isSubscriptionChecked, setIsSubscriptionChecked] = useState(false)
  const { data: session } = authClient.useSession()
  const currentUser = session?.user

  // TRPC mutations
  const checkNewsletterStatusMutation = trpc.newsletters.checkNewsletterStatus.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setIsSubscriptionChecked(result.subscribed)
        form.setValue('subscribed', result.subscribed)
      } else {
        console.error('check subscription status error:', result.error)
        setError(result.error || '检查订阅状态失败')
        setIsSubscriptionChecked(false)
        form.setValue('subscribed', false)
      }
    },
    onError: (error) => {
      console.error('check subscription status error:', error)
      setError('检查订阅状态失败')
      setIsSubscriptionChecked(false)
      form.setValue('subscribed', false)
    },
  })

  const subscribeNewsletterMutation = trpc.newsletters.subscribeNewsletter.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('newsletter.subscribeSuccess'))
        setIsSubscriptionChecked(true)
        form.setValue('subscribed', true)
        setError('')
      } else {
        const errorMessage = result.error || t('newsletter.subscribeFail')
        toast.error(errorMessage)
        setError(errorMessage)
        form.setValue('subscribed', false)
      }
    },
    onError: (error) => {
      console.error('newsletter subscription error:', error)
      setError(t('newsletter.error'))
      toast.error(t('newsletter.error'))
      form.setValue('subscribed', isSubscriptionChecked)
    },
  })

  const unsubscribeNewsletterMutation = trpc.newsletters.unsubscribeNewsletter.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('newsletter.unsubscribeSuccess'))
        setIsSubscriptionChecked(false)
        form.setValue('subscribed', false)
        setError('')
      } else {
        const errorMessage = result.error || t('newsletter.unsubscribeFail')
        toast.error(errorMessage)
        setError(errorMessage)
        form.setValue('subscribed', true)
      }
    },
    onError: (error) => {
      console.error('newsletter unsubscription error:', error)
      setError(t('newsletter.error'))
      toast.error(t('newsletter.error'))
      form.setValue('subscribed', isSubscriptionChecked)
    },
  })

  // 计算loading状态
  const isLoading =
    checkNewsletterStatusMutation.isPending ||
    subscribeNewsletterMutation.isPending ||
    unsubscribeNewsletterMutation.isPending

  // Create a schema for newsletter subscription
  const formSchema = z.object({
    subscribed: z.boolean(),
  })

  // Initialize the form
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      subscribed: false,
    },
  })

  // Check subscription status on component mount
  useEffect(() => {
    if (currentUser?.email) {
      checkNewsletterStatusMutation.mutate({
        email: currentUser.email,
      })
    }
  }, [currentUser?.email])

  // Check if user exists after all hooks are initialized
  if (!currentUser) {
    return null
  }

  // Handle checkbox change
  const handleSubscriptionChange = (value: boolean) => {
    if (!currentUser?.email) {
      setError(t('newsletter.emailRequired'))
      return
    }

    setError('')

    if (value) {
      // Subscribe to newsletter using trpc mutation
      subscribeNewsletterMutation.mutate({
        email: currentUser.email,
      })
    } else {
      // Unsubscribe from newsletter using trpc mutation
      unsubscribeNewsletterMutation.mutate({
        email: currentUser.email,
      })
    }
  }

  return (
    <Card className={cn('w-full max-w-lg overflow-hidden pt-6 pb-0 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('newsletter.title')}</CardTitle>
        <CardDescription>{t('newsletter.description')}</CardDescription>
      </CardHeader>
      <form>
        <CardContent className='space-y-4'>
          <Controller
            control={form.control}
            name='subscribed'
            render={({ field }) => (
              <div className='flex flex-row items-center justify-between'>
                <div className='space-y-0.5'>
                  <span className='text-base'>{t('newsletter.label')}</span>
                </div>
                <div className='relative flex items-center'>
                  {isLoading && <Loader2Icon className='mr-2 size-4 animate-spin text-primary' />}
                  <Switch
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked)
                      handleSubscriptionChange(checked)
                    }}
                    disabled={isLoading}
                    aria-readonly={isLoading}
                    className='cursor-pointer'
                  />
                </div>
              </div>
            )}
          />
          <FormError message={error} />
        </CardContent>
        <CardFooter className='mt-6 rounded-none bg-background px-6 py-4'>
          <p className='text-muted-foreground text-sm'>{t('newsletter.hint')}</p>
        </CardFooter>
      </form>
    </Card>
  )
}
