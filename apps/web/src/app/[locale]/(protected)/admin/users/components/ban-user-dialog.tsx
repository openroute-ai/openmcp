'use client'

import { useState } from 'react'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'

export interface BanTarget {
  id: string
  name: string
  email: string
  /** Current ban state; decides whether the dialog offers ban or unban. */
  banned: boolean
}

interface BanUserDialogProps {
  target: BanTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

/** Ban duration options, in better-auth's seconds. `0` means permanent. */
const DURATIONS = [
  { value: '0', label: '永久封禁' },
  { value: '3600', label: '1 小时' },
  { value: '86400', label: '24 小时' },
  { value: '604800', label: '7 天' },
  { value: '2592000', label: '30 天' },
] as const

/**
 * Ban / unban a user.
 *
 * The reason is required by the schema rather than only checked in the UI, and
 * the same dialog handles unban so the two actions sit in one place. The
 * duration select maps to `banExpiresIn` seconds; permanent sends nothing and
 * the router leaves `banExpires` null.
 */
export function BanUserDialog({ target, open, onOpenChange, onSuccess }: BanUserDialogProps) {
  const utils = trpc.useUtils()
  const banMutation = trpc.admin.users.banUser.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        toast.success('已封禁该用户')
        onOpenChange(false)
        onSuccess()
        await utils.admin.users.getUserById.invalidate()
        await utils.admin.sessions.getSessionsByUserId.invalidate()
      } else {
        toast.error(data.error)
      }
    },
    onError: (error) => toast.error(error.message || '封禁失败'),
  })

  const unbanMutation = trpc.admin.users.unbanUser.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        toast.success('已解除封禁')
        onOpenChange(false)
        onSuccess()
        await utils.admin.users.getUserById.invalidate()
      } else {
        toast.error(data.error)
      }
    },
    onError: (error) => toast.error(error.message || '解除封禁失败'),
  })

  if (!target) return null

  const isBanned = target.banned
  const isPending = banMutation.isPending || unbanMutation.isPending

  // Keyed on the user id so opening the dialog for a different account starts
  // with an empty form. Remounting on change is what resets `reason` and
  // `duration`; doing it in an effect would mean the first render after opening
  // briefly shows the previous user's text.
  return (
    <BanUserDialogForm
      key={target.id}
      target={target}
      isBanned={isBanned}
      isPending={isPending}
      open={open}
      onOpenChange={onOpenChange}
      banPending={banMutation.isPending}
      unbanPending={unbanMutation.isPending}
      onBan={(banReason, banExpiresIn) =>
        banMutation.mutate({ userId: target.id, banReason, banExpiresIn })
      }
      onUnban={() => unbanMutation.mutate({ userId: target.id })}
    />
  )
}

interface BanUserDialogFormProps {
  target: BanTarget
  isBanned: boolean
  isPending: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  banPending: boolean
  unbanPending: boolean
  onBan: (reason: string, banExpiresIn: number | undefined) => void
  onUnban: () => void
}

/** Inner form, remounted per user so local state never leaks between accounts. */
function BanUserDialogForm({
  target,
  isBanned,
  isPending,
  open,
  onOpenChange,
  banPending,
  unbanPending,
  onBan,
  onUnban,
}: BanUserDialogFormProps) {
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<string>('0')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>{isBanned ? '解除封禁' : '封禁用户'}</DialogTitle>
          <DialogDescription>
            {isBanned
              ? `将恢复 ${target.name}（${target.email}）的登录权限。`
              : `将阻止 ${target.name}（${target.email}）登录。已有会话仍有效，需要同时吊销会话。`}
          </DialogDescription>
        </DialogHeader>

        {isBanned ? (
          <DialogFooter>
            <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isPending}>
              取消
            </Button>
            <Button onClick={onUnban} disabled={isPending}>
              {unbanPending ? '处理中...' : '解除封禁'}
            </Button>
          </DialogFooter>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='ban-reason'>封禁原因</Label>
              <Textarea
                id='ban-reason'
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder='请说明封禁原因，该内容会记录在用户详情页'
                rows={3}
                maxLength={500}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='ban-duration'>封禁时长</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id='ban-duration'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className='text-muted-foreground text-xs'>
              封禁不会立即终止已登录的会话。如需立即下线，请在该用户详情页吊销全部会话。
            </p>

            <DialogFooter>
              <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isPending}>
                取消
              </Button>
              <Button
                variant='destructive'
                disabled={isPending || !reason.trim()}
                onClick={() =>
                  onBan(reason.trim(), duration === '0' ? undefined : Number(duration))
                }
              >
                {banPending ? '处理中...' : '确认封禁'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
