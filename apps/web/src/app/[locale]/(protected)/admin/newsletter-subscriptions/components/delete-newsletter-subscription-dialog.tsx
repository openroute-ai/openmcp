'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import type { AdminNewsletterSubscriptionRow } from '../types'

interface DeleteNewsletterSubscriptionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subscription: AdminNewsletterSubscriptionRow | null
  onConfirm: () => void
  isLoading?: boolean
}

/**
 * Removing a row is not reversible and drops the opt-out history, so the
 * address is spelled out in the confirmation rather than shown as an id.
 *
 * This component only confirms intent. The mutation belongs to the page, which
 * already owns the cache invalidation and the toast — owning it here as well
 * would fire the delete twice.
 */
export function DeleteNewsletterSubscriptionDialog({
  open,
  onOpenChange,
  subscription,
  onConfirm,
  isLoading,
}: DeleteNewsletterSubscriptionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除订阅？</AlertDialogTitle>
          <AlertDialogDescription>
            将永久删除 <span className='font-medium text-foreground'>{subscription?.email}</span>{' '}
            的订阅记录，此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className='cursor-pointer' disabled={isLoading}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            className='cursor-pointer bg-destructive text-white hover:bg-destructive/90'
            disabled={isLoading}
            onClick={(event) => {
              // Keep the dialog mounted while the mutation settles so the
              // disabled state is visible instead of the row vanishing.
              event.preventDefault()
              onConfirm()
            }}
          >
            {isLoading ? '删除中…' : '删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
