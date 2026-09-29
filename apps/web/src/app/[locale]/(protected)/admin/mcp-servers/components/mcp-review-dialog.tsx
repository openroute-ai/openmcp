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
import { billingLabel } from '@/lib/registry-labels'
import { trpc } from '@/lib/trpc/client'

interface McpReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  server: any | null
  onSuccess: () => void
}

export function McpReviewDialog({ open, onOpenChange, server, onSuccess }: McpReviewDialogProps) {
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote(
      (server?.metadata as Record<string, unknown>)?.reviewNote ? String((server.metadata as any).reviewNote) : ''
    )
  }, [server])

  const reviewMutation = trpc.admin.mcpServers.reviewServer.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('审核成功，MCP Server 已上架')
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
    if (!server?.id) return
    reviewMutation.mutate({
      id: server.id,
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
    return map[server?.status] || server?.status || '-'
  })()

  if (!server) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>审核 MCP Server</DialogTitle>
          <DialogDescription>通过后将上架到 MCP 货架，驳回将返回作者修改</DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          <div className='space-y-4'>
            <div>
              <Label className='font-medium text-muted-foreground text-sm'>服务名称</Label>
              <div className='mt-1 font-semibold text-base'>{server.name}</div>
              {server.endpoint && <div className='mt-0.5 text-muted-foreground text-sm'>{server.endpoint}</div>}
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前状态</Label>
                <div className='mt-1'>
                  <Badge variant={server.status === 'published' ? 'default' : 'outline'}>{statusLabel}</Badge>
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>作者</Label>
                <div className='mt-1 text-sm'>
                  {server.author?.name || '-'}
                  {server.author?.verified ? '（已认证）' : ''}
                </div>
              </div>
            </div>

            {server.description && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>描述</Label>
                <div className='mt-1 text-sm'>{server.description}</div>
              </div>
            )}

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>传输/托管</Label>
                <div className='mt-1 text-sm'>
                  {server.transport?.toUpperCase()}
                  {server.hosting ? ` · ${server.hosting === 'platform_managed' ? '平台托管' : '自托管'}` : ''}
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>价格</Label>
                <div className='mt-1 text-sm'>
                  {server.priceType === 'paid'
                    ? `付费${server.unitPrice ? ` ${server.unitPrice} ${server.currency || 'CNY'}` : ''}`
                    : '免费'}
                  {server.billingModel ? `（${billingLabel(server.billingModel, 'zh')}）` : ''}
                </div>
              </div>
            </div>

            <div className='grid grid-cols-3 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>浏览</Label>
                <div className='mt-1 font-semibold text-lg'>{server.views || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>下载</Label>
                <div className='mt-1 font-semibold text-lg'>{server.downloads || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>创建时间</Label>
                <div className='mt-1 text-sm'>
                  {server.createdAt ? format(new Date(server.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                </div>
              </div>
            </div>

            {server.metadata?.reviewNote && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前审核备注</Label>
                <div className='mt-1 rounded-md bg-muted p-2 text-sm'>{String(server.metadata.reviewNote)}</div>
              </div>
            )}
          </div>

          <div className='space-y-4 border-t pt-4'>
            <div>
              <Label htmlFor='mcp-review-note'>审核备注</Label>
              <Textarea
                id='mcp-review-note'
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
                  通过并上架后服务将对用户可见；驳回后作者可修改后重新提交审核
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
