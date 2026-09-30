'use client'

import { MessageCircle, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { WeChatQRDialog } from '@/components/contact/wechat-qr-dialog'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@/lib/utils'

interface FirstLoginPromptProps {
  show: boolean
  onDismiss: () => void
  className?: string
}

/**
 * First-login banner: a one-line welcome with a WeChat escape hatch.
 *
 * The prompt exists because a brand-new account often cannot do anything useful
 * yet (needs a top-up, a phone number, a verified identity) and the fastest way
 * to unblock someone is to talk to them. The QR dialog is therefore the primary
 * action, not a footnote.
 */
export function FirstLoginPrompt({ show, onDismiss, className }: FirstLoginPromptProps) {
  const t = useTranslations('Dashboard.firstLoginPrompt')
  const [dialogOpen, setDialogOpen] = useState(false)

  if (!show) return null

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border bg-blue-50/50 px-3 py-1.5 text-sm dark:bg-blue-950/20',
          className
        )}
        role='alert'
      >
        <MessageCircle className='h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400' />
        <span className='text-blue-900 dark:text-blue-100'>{t('message')}</span>
        <Button
          variant='ghost'
          size='sm'
          className='h-auto cursor-pointer p-0 px-1 text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100'
          onClick={() => setDialogOpen(true)}
          aria-label={t('openDialog')}
        >
          {t('action')}
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-4 w-4 shrink-0 cursor-pointer p-0 text-blue-600 hover:text-blue-800 dark:text-blue-400'
          onClick={onDismiss}
          aria-label={t('dismiss')}
        >
          <X className='h-3 w-3' />
        </Button>
      </div>

      <WeChatQRDialog open={dialogOpen} onOpenChange={setDialogOpen} asIconButton={false} />
    </>
  )
}
