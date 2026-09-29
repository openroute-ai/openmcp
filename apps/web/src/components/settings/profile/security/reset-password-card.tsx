'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useLocaleRouter } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

interface ResetPasswordCardProps {
  className?: string
}

/**
 * Reset Password Card
 *
 * This component guides users who signed up with social providers
 * to set up a password through the forgot password flow.
 *
 * How it works:
 * 1. When a user signs in with a social provider, they don't have a password set up
 * 2. This component provides a way for them to set up a password using the forgot password flow
 * 3. The user clicks the button and is redirected to the forgot password page
 * 4. They enter their email (which is already associated with their account)
 * 5. They receive a password reset email
 * 6. After setting a password, they can now login with either:
 *    - Their social provider (as before)
 *    - Their email and the new password
 *
 * This effectively adds a credential provider to their account, enabling email/password login.
 */
export function ResetPasswordCard({ className }: ResetPasswordCardProps) {
  const t = useTranslations('Dashboard.settings.security.resetPassword')
  const router = useLocaleRouter()
  const { data: session } = authClient.useSession()

  const handleSetupPassword = () => {
    // Pre-fill the email if available to make it easier for the user
    if (session?.user?.email) {
      router.push(`/auth/forgot-password?email=${encodeURIComponent(session.user.email)}`)
    } else {
      router.push('/auth/forgot-password')
    }
  }

  return (
    <Card className={cn('flex w-full max-w-lg flex-col overflow-hidden pt-6 pb-0 md:max-w-xl', className)}>
      <CardHeader>
        <CardTitle className='font-semibold text-lg'>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex-1 space-y-4'>
        <p className='text-muted-foreground text-sm'>{t('info')}</p>
      </CardContent>
      <CardFooter className='mt-auto flex items-center justify-end rounded-none bg-background px-6 py-4'>
        <Button onClick={handleSetupPassword} className='cursor-pointer'>
          {t('button')}
        </Button>
      </CardFooter>
    </Card>
  )
}
