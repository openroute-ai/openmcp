'use client'

import { Badge } from '@workspace/ui/components/badge'
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
import { Textarea } from '@workspace/ui/components/textarea'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authLabel, billingLabel } from '@/lib/registry-labels'
import { trpc } from '@/lib/trpc/client'

interface A2aReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: any | null
  onSuccess: () => void
}

export function A2aReviewDialog({ open, onOpenChange, agent, onSuccess }: A2aReviewDialogProps) {
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote((agent?.metadata as Record<string, unknown>)?.reviewNote ? String((agent.metadata as any).reviewNote) : '')
  }, [agent])

  const reviewMutation = trpc.admin.a2aAgents.reviewAgent.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.data?.status === 'published' ? '审核通过，智能体已上架' : '已驳回该智能体')
        onSuccess()
      } else {
        toast.error(data.error || '审核失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '审核失败')
    },
  })

  const handleReview = (action: 'approve' | 'reject') => {
    if (!agent?.id) return
    reviewMutation.mutate({
      id: agent.id,
      action,
      note: note || undefined,
    })
  }

  const statusLabel = (() => {
    const map: Record<string, string> = {
      draft: '草稿',
      submitted: '待审核',
      published: '已上架',
      archived: '已归档',
      rejected: '已驳回',
    }
    return map[agent?.status] || agent?.status || '-'
  })()

  if (!agent) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>审核 A2A 智能体</DialogTitle>
          <DialogDescription>通过后将上架到 A2A 货架，驳回将返回作者修改</DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          <div className='space-y-4'>
            <div>
              <Label className='font-medium text-muted-foreground text-sm'>智能体名称</Label>
              <div className='mt-1 font-semibold text-base'>{agent.name}</div>
              {agent.agentCardUrl && <div className='mt-0.5 text-muted-foreground text-sm'>{agent.agentCardUrl}</div>}
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前状态</Label>
                <div className='mt-1'>
                  <Badge variant={agent.status === 'published' ? 'default' : 'outline'}>{statusLabel}</Badge>
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>作者</Label>
                <div className='mt-1 text-sm'>
                  {agent.author?.name || '-'}
                  {agent.author?.verified ? '（已认证）' : ''}
                </div>
              </div>
            </div>

            {agent.description && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>描述</Label>
                <div className='mt-1 text-sm'>{agent.description}</div>
              </div>
            )}

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>认证方式</Label>
                <div className='mt-1 text-sm'>{authLabel(agent.authType, 'zh')}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>价格</Label>
                <div className='mt-1 text-sm'>
                  {agent.priceType === 'paid'
                    ? `付费${agent.unitPrice ? ` ${agent.unitPrice} ${agent.currency || 'CNY'}` : ''}`
                    : '免费'}
                  {agent.billingModel ? `（${billingLabel(agent.billingModel, 'zh')}）` : ''}
                </div>
              </div>
            </div>

            <div className='grid grid-cols-3 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>浏览</Label>
                <div className='mt-1 font-semibold text-lg'>{agent.views || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>下载</Label>
                <div className='mt-1 font-semibold text-lg'>{agent.downloads || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>创建时间</Label>
                <div className='mt-1 text-sm'>
                  {agent.createdAt ? format(new Date(agent.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                </div>
              </div>
            </div>

            {agent.metadata?.reviewNote && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前审核备注</Label>
                <div className='mt-1 rounded-md bg-muted p-2 text-sm'>{String(agent.metadata.reviewNote)}</div>
              </div>
            )}
          </div>

          <div className='space-y-4 border-t pt-4'>
            <div>
              <Label htmlFor='a2a-review-note'>审核备注</Label>
              <Textarea
                id='a2a-review-note'
                placeholder='请输入审核备注，说明通过或驳回原因（可选）'
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className='mt-2'
                rows={4}
              />
            </div>

            <div className='flex items-center justify-between rounded-md bg-muted p-4'>
              <div className='text-sm'>
                <div className='font-medium'>操作说明</div>
                <div className='mt-1 text-muted-foreground'>
                  通过并上架后智能体将对用户可见；驳回后作者可修改后重新提交审核
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className='gap-2 sm:gap-0'>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={reviewMutation.isPending}>
            取消
          </Button>
          <Button variant='destructive' onClick={() => handleReview('reject')} disabled={reviewMutation.isPending}>
            {reviewMutation.isPending ? '处理中...' : '驳回'}
          </Button>
          <Button onClick={() => handleReview('approve')} disabled={reviewMutation.isPending}>
            {reviewMutation.isPending ? '处理中...' : '通过并上架'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
