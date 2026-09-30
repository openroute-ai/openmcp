'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { trpc } from '@/lib/trpc/client'

interface CreateNewsletterSubscriptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const EMPTY_FORM = { email: '', source: 'import' }

/**
 * Adds a subscriber by hand, e.g. an address imported from a list.
 *
 * Only the columns an operator can meaningfully supply are exposed: the UTM and
 * request-fingerprint columns are written by the public form and would be noise
 * here.
 */
export function CreateNewsletterSubscriptionDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateNewsletterSubscriptionDialogProps) {
  const [formData, setFormData] = useState(EMPTY_FORM)

  const createMutation = trpc.admin.newsletterSubscriptions.createNewsletterSubscription.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success('订阅已创建')
        setFormData(EMPTY_FORM)
        onSuccess()
      } else {
        toast.error(result.error || '创建失败')
      }
    },
    onError: (error) => toast.error(error.message || '创建失败'),
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    createMutation.mutate({ email: formData.email, source: formData.source || 'import' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>新增订阅</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='newsletter-email'>邮箱 *</Label>
            <Input
              id='newsletter-email'
              type='email'
              required
              value={formData.email}
              onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
              placeholder='user@example.com'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='newsletter-source'>来源</Label>
            <Input
              id='newsletter-source'
              value={formData.source}
              onChange={(event) => setFormData((prev) => ({ ...prev, source: event.target.value }))}
              placeholder='import'
            />
          </div>

          <div className='flex justify-end gap-2'>
            <Button type='button' variant='outline' className='cursor-pointer' onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type='submit' className='cursor-pointer' disabled={createMutation.isPending}>
              {createMutation.isPending ? '创建中…' : '创建'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
