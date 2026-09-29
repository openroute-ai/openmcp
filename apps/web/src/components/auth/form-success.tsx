'use client'

import { CheckCircle2Icon } from 'lucide-react'

interface FormSuccessProps {
  message?: string
}

/** Inline confirmation banner, e.g. "verification code sent". */
export function FormSuccess({ message }: FormSuccessProps) {
  if (!message) return null

  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-600">
      <CheckCircle2Icon className="size-4 shrink-0" />
      <p>{message}</p>
    </div>
  )
}
