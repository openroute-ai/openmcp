'use client'

import { cn } from '@workspace/ui/lib/utils'
import { EmailLoginForm } from '@/components/auth/email-login-form'
import { PhoneLoginForm } from '@/components/auth/phone-login-form'
import type { SocialProviderId } from '@/lib/auth/social-providers'
import { useAuthStore } from '@/lib/stores/auth-store'

export interface UnifiedLoginFormProps {
  className?: string
  /** Providers registered on the server; forwarded to the credential form. */
  socialProviders?: SocialProviderId[]
}

/**
 * Renders whichever credential flow the visitor last chose, so switching
 * between phone and email does not need a separate route.
 */
export function UnifiedLoginForm({ className, socialProviders }: UnifiedLoginFormProps) {
  const { authMode } = useAuthStore()

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {authMode === 'phone' && <PhoneLoginForm />}
      {authMode === 'email' && <EmailLoginForm socialProviders={socialProviders} />}
    </div>
  )
}
