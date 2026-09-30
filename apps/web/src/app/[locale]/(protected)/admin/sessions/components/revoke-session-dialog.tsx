'use client'

import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Label } from '@workspace/ui/components/label'
import type { AdminSessionRow } from '../types'

interface RevokeSessionDialogProps {
  session: AdminSessionRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isLoading?: boolean
}

/**
 * Confirm revoking a session.
 *
 * Revoking deletes the row, so the user's next request fails authentication and
 * they must sign in again. The dialog names the user and IP so the operator can
 * confirm they picked the right row.
 */
export function RevokeSessionDialog({
  session,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: RevokeSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>吊销会话</DialogTitle>
          <DialogDescription>
            吊销后该会话立即失效，用户需要重新登录。此操作不可撤销。
          </DialogDescription>
        </DialogHeader>

        {session && (
          <div className='space-y-2 rounded-md border p-3 text-sm'>
            <div className='flex justify-between gap-4'>
              <Label className='text-muted-foreground'>用户</Label>
              <span className='text-right'>
                {session.userName || session.userEmail || '未知用户'}
              </span>
            </div>
            <div className='flex justify-between gap-4'>
              <Label className='text-muted-foreground'>IP 地址</Label>
              <span className='font-mono text-right'>{session.ipAddress ?? '-'}</span>
            </div>
            <div className='flex justify-between gap-4'>
              <Label className='text-muted-foreground'>创建时间</Label>
              <span className='text-right'>{session.createdAt.toLocaleString('zh-CN')}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isLoading}>
            取消
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isLoading}>
            {isLoading ? '处理中...' : '确认吊销'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
