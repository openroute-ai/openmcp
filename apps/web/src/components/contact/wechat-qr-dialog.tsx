'use client'

import { Check, Copy, MessageCircle } from 'lucide-react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@workspace/ui/components/dialog'
import { cn } from '@/lib/utils'

interface WeChatQRDialogProps {
  /** Path to the QR image in `public/`. */
  qrCodeUrl?: string
  /** Handle the visitor should add. */
  wechatId?: string
  buttonText?: string
  showIcon?: boolean
  className?: string
  /** Render the trigger as a square icon-only button. */
  asIconButton?: boolean
  /** Controlled open state; when omitted the dialog manages its own. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * WeChat contact dialog: QR code plus a copyable handle.
 *
 * The QR is a static asset rather than a generated code, so a missing file has
 * to degrade to a readable handle rather than a broken image icon — hence the
 * error fallback that swaps in the text version.
 */
export function WeChatQRDialog({
  qrCodeUrl = '/images/pm.jpg',
  wechatId = 'qijianbin001',
  buttonText,
  showIcon = true,
  className,
  asIconButton = false,
  open: controlledOpen,
  onOpenChange,
}: WeChatQRDialogProps) {
  const t = useTranslations('ContactPage.wechat')
  const [internalOpen, setInternalOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = (nextOpen: boolean) => {
    if (isControlled) {
      onOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
    if (!nextOpen) setCopied(false)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(wechatId)
      setCopied(true)
      toast.success(t('copySuccess'))
    } catch (error) {
      console.error('copy WeChat id failed:', error)
      toast.error(t('copyFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            variant='outline'
            className={cn('cursor-pointer gap-2', asIconButton && 'px-2', className)}
            aria-label={t('openDialog')}
          >
            {showIcon && <MessageCircle className='h-4 w-4' />}
            {!asIconButton && (buttonText || t('contactWeChat'))}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <MessageCircle className='h-5 w-5 text-green-600' />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className='flex flex-col items-center space-y-4 py-4'>
          <div className='rounded-lg border-2 border-border bg-white p-4 shadow-sm'>
            {imageFailed ? (
              <div className='flex h-64 w-64 items-center justify-center bg-muted text-muted-foreground text-sm'>
                {t('qrCodePlaceholder')}
              </div>
            ) : (
              <Image
                src={qrCodeUrl}
                alt={t('qrCodeAlt')}
                width={256}
                height={256}
                className='h-64 w-64 object-contain'
                onError={() => setImageFailed(true)}
              />
            )}
          </div>

          <div className='w-full space-y-2'>
            <div className='flex items-center justify-center gap-2'>
              <span className='font-medium text-muted-foreground text-sm'>{t('wechatId')}:</span>
              <span className='font-semibold text-sm'>{wechatId}</span>
            </div>
            <Button
              onClick={handleCopy}
              variant='outline'
              size='sm'
              className='w-full cursor-pointer gap-2'
              aria-label={t('copy')}
            >
              {copied ? (
                <>
                  <Check className='h-4 w-4 text-green-600' />
                  <span>{t('copied')}</span>
                </>
              ) : (
                <>
                  <Copy className='h-4 w-4' />
                  <span>{t('copy')}</span>
                </>
              )}
            </Button>
          </div>

          <div className='space-y-1 text-center text-muted-foreground text-sm'>
            <p className='font-medium text-foreground'>{t('supportNote')}</p>
            <p>{t('instruction1')}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
