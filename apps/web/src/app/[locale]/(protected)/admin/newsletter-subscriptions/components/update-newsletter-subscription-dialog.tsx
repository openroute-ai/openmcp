'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { trpc } from '@/lib/trpc/client'
import type { AdminNewsletterSubscriptionRow } from '../types'

interface UpdateNewsletterSubscriptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: AdminNewsletterSubscriptionRow | null
  onSuccess: () => void
}

/**
 * Edit a subscriber row.
 *
 * The form is re-seeded from `subscription` each time it opens, so switching
 * between rows never shows the previous row's values. Blank text and
 * `datetime-local` fields are sent as `null` to clear the column instead of
 * writing an empty string.
 */
export function UpdateNewsletterSubscriptionDialog({
  open,
  onOpenChange,
  subscription,
  onSuccess,
}: UpdateNewsletterSubscriptionDialogProps) {
  const [formData, setFormData] = useState({
    email: '',
    source: '',
    emailSentCount: '0',
    subscribedAt: '',
    unsubscribedAt: '',
    lastEmailSentAt: '',
  })

  useEffect(() => {
    if (!open || !subscription) return

    const toLocalInput = (value: Date | null) => {
      if (!value) return ''
      const offset = value.getTimezoneOffset() * 60_000
      return new Date(value.getTime() - offset).toISOString().slice(0, 16)
    }

    setFormData({
      email: subscription.email,
      source: subscription.source ?? '',
      emailSentCount: String(subscription.emailSentCount),
      subscribedAt: toLocalInput(subscription.subscribedAt),
      unsubscribedAt: toLocalInput(subscription.unsubscribedAt),
      lastEmailSentAt: toLocalInput(subscription.lastEmailSentAt),
    })
  }, [open, subscription])

  const updateMutation = trpc.admin.newsletterSubscriptions.updateNewsletterSubscription.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success('订阅已更新')
        onSuccess()
      } else {
        toast.error(result.error || '更新失败')
      }
    },
    onError: (error) => toast.error(error.message || '更新失败'),
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!subscription) return

    const parseDate = (value: string) => (value ? new Date(value) : null)

    // `subscribed_at` is NOT NULL, so an empty field keeps the stored value
    // rather than sending null.
    const subscribedAt = parseDate(formData.subscribedAt) ?? subscription.subscribedAt

    updateMutation.mutate({
      id: subscription.id,
      email: formData.email,
      subscribed: subscription.subscribed,
      source: formData.source || null,
      emailSentCount: Number(formData.emailSentCount) || 0,
      subscribedAt,
      unsubscribedAt: parseDate(formData.unsubscribedAt),
      lastEmailSentAt: parseDate(formData.lastEmailSentAt),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>编辑订阅</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='update-newsletter-email'>邮箱 *</Label>
            <Input
              id='update-newsletter-email'
              type='email'
              required
              value={formData.email}
              onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='update-newsletter-source'>来源</Label>
            <Input
              id='update-newsletter-source'
              value={formData.source}
              onChange={(event) => setFormData((prev) => ({ ...prev, source: event.target.value }))}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='update-newsletter-sent'>已发邮件数</Label>
            <Input
              id='update-newsletter-sent'
              type='number'
              min='0'
              value={formData.emailSentCount}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, emailSentCount: event.target.value }))
              }
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='update-newsletter-subscribed-at'>订阅时间</Label>
              <Input
                id='update-newsletter-subscribed-at'
                type='datetime-local'
                value={formData.subscribedAt}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, subscribedAt: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='update-newsletter-unsubscribed-at'>退订时间</Label>
              <Input
                id='update-newsletter-unsubscribed-at'
                type='datetime-local'
                value={formData.unsubscribedAt}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, unsubscribedAt: event.target.value }))
                }
              />
            </div>
          </div>

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' className='cursor-pointer' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' className='cursor-pointer' disabled={updateMutation.isPending}>
              {updateMutation.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
