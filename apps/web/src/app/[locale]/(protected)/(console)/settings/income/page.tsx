'use client'

import { useEffect } from 'react'
import { useLocaleRouter } from '@/i18n/navigation'
import { Routes } from '@/lib/routes'

/** Soft-redirect legacy income bills page to the earnings center. */
export default function IncomeRedirectPage() {
  const router = useLocaleRouter()

  useEffect(() => {
    router.replace(Routes.DashboardEarnings)
  }, [router])

  return null
}
