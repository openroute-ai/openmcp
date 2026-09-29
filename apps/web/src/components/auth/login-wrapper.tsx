'use client'

import { useLocaleRouter } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

interface LoginWrapperProps {
  children: React.ReactNode
  mode?: 'modal' | 'redirect'
  asChild?: boolean
  callbackUrl?: string
}

/**
 * Wraps a trigger so that activating it sends the visitor to the sign-in page.
 *
 * The upstream app rendered a full login form inside a dialog here. This repo
 * already owns authentication on `/sign-in`, so the wrapper only routes and
 * preserves `callbackUrl`; `modal` therefore behaves like `redirect`.
 */
export const LoginWrapper = ({ children, callbackUrl }: LoginWrapperProps) => {
  const router = useLocaleRouter()

  const handleLogin = () => {
    const loginPath = callbackUrl
      ? `${Routes.Login}?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : Routes.Login
    router.push(loginPath)
  }

  return (
    <span onClick={handleLogin} className='cursor-pointer'>
      {children}
    </span>
  )
}
