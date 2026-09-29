'use client'

import { AlertCircleIcon } from 'lucide-react'

interface FormErrorProps {
  message?: string
}

/** Inline error banner for a failed submit that has no dedicated field. */
export function FormError({ message }: FormErrorProps) {
  if (!message) return null

  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircleIcon className="size-4 shrink-0" />
      <p>{message}</p>
    </div>
  )
}
