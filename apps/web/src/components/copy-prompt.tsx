'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface CopyPromptProps {
  text: string
  label?: string
  className?: string
}

/**
 * Copies a prompt to the clipboard and confirms it inline for a couple of
 * seconds. The label is translated; the text itself is supplied by the caller
 * because it is a prompt, not UI copy.
 */
export function CopyPrompt({ text, label, className }: CopyPromptProps) {
  const t = useTranslations('Common')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; leave the label unchanged so the
      // failure is visible rather than silently pretending it worked.
    }
  }

  return (
    <button
      type='button'
      onClick={handleCopy}
      className={`inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 font-medium text-sm transition-colors ${className ?? ''}`}
    >
      {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
      {copied ? t('copied') : (label ?? t('copy'))}
    </button>
  )
}
