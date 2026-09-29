'use client'

import { format } from 'date-fns'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
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
import { trpc } from '@/lib/trpc/client'

interface CertificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflow: any | null
  onSuccess: () => void
}

export function CertificationDialog({ open, onOpenChange, workflow, onSuccess }: CertificationDialogProps) {
  const [certificationNote, setCertificationNote] = useState('')
  const [certified, setCertified] = useState(false)

  // 获取工作流详情
  const { data: workflowDetail, refetch: refetchWorkflow } = trpc.admin.workflows.getWorkflowById.useQuery(
    { id: workflow?.id || '' },
    { enabled: !!workflow?.id && open }
  )

  useEffect(() => {
    if (workflowDetail?.success && workflowDetail.data) {
      setCertified(workflowDetail.data.certified || false)
      setCertificationNote(workflowDetail.data.certificationNote || '')
    }
  }, [workflowDetail])

  const certifyMutation = trpc.admin.workflows.certifyWorkflow.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        const newCertifiedStatus = data.data?.certified || false
        toast.success(newCertifiedStatus ? '工作流认证成功' : '工作流取消认证成功')
        setCertified(newCertifiedStatus)
        onSuccess()
      } else {
        toast.error(data.error || '操作失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '操作失败')
    },
  })

  const handleSubmit = () => {
    if (!workflow?.id) return

    const newCertifiedStatus = !certified // 切换认证状态
    certifyMutation.mutate({
      id: workflow.id,
      certified: newCertifiedStatus,
      certificationNote: certificationNote || undefined,
    })
  }

  const currentWorkflow = workflowDetail?.success ? workflowDetail.data : workflow

  if (!currentWorkflow) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>工作流认证审核</DialogTitle>
          <DialogDescription>审核并管理工作流的认证状态</DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          {/* 工作流基本信息 */}
          <div className='space-y-4'>
            <div>
              <Label className='font-medium text-muted-foreground text-sm'>工作流标题</Label>
              <div className='mt-1 font-semibold text-base'>{currentWorkflow.title}</div>
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前状态</Label>
                <div className='mt-1'>
                  {currentWorkflow.certified ? (
                    <Badge variant='default'>已认证</Badge>
                  ) : (
                    <Badge variant='outline'>未认证</Badge>
                  )}
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>工作流状态</Label>
                <div className='mt-1'>
                  {currentWorkflow.status === 'published' ? (
                    <Badge variant='default'>已发布</Badge>
                  ) : currentWorkflow.status === 'draft' ? (
                    <Badge variant='secondary'>草稿</Badge>
                  ) : currentWorkflow.status === 'archived' ? (
                    <Badge variant='outline'>已归档</Badge>
                  ) : (
                    <Badge variant='destructive'>已拒绝</Badge>
                  )}
                </div>
              </div>
            </div>

            {currentWorkflow.description && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>描述</Label>
                <div className='mt-1 text-sm'>{currentWorkflow.description}</div>
              </div>
            )}

            {currentWorkflow.author && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>作者</Label>
                <div className='mt-1'>
                  <Link href={`/admin/authors/${currentWorkflow.author.id}`} className='text-primary hover:underline'>
                    {currentWorkflow.author.name}
                  </Link>
                </div>
              </div>
            )}

            {currentWorkflow.certifiedAt && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>认证时间</Label>
                <div className='mt-1 text-sm'>
                  {format(new Date(currentWorkflow.certifiedAt), 'yyyy-MM-dd HH:mm:ss')}
                </div>
              </div>
            )}

            {currentWorkflow.certificationNote && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前认证备注</Label>
                <div className='mt-1 rounded-md bg-muted p-2 text-sm'>{currentWorkflow.certificationNote}</div>
              </div>
            )}

            <div className='grid grid-cols-3 gap-4 border-t pt-2'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>浏览次数</Label>
                <div className='mt-1 font-semibold text-lg'>{currentWorkflow.views || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>下载次数</Label>
                <div className='mt-1 font-semibold text-lg'>{currentWorkflow.downloads || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>点赞数</Label>
                <div className='mt-1 font-semibold text-lg'>{currentWorkflow.likes || 0}</div>
              </div>
            </div>
          </div>

          {/* 认证操作 */}
          <div className='space-y-4 border-t pt-4'>
            <div>
              <Label htmlFor='certification-note'>认证备注</Label>
              <Textarea
                id='certification-note'
                placeholder='请输入认证备注（可选）'
                value={certificationNote}
                onChange={(e) => setCertificationNote(e.target.value)}
                className='mt-2'
                rows={4}
              />
              <p className='mt-1 text-muted-foreground text-xs'>
                认证备注将记录在认证信息中，用于说明认证原因或注意事项
              </p>
            </div>

            <div className='flex items-center justify-between rounded-md bg-muted p-4'>
              <div>
                <div className='font-medium'>{currentWorkflow.certified ? '当前状态：已认证' : '当前状态：未认证'}</div>
                <div className='mt-1 text-muted-foreground text-sm'>
                  {currentWorkflow.certified ? '点击下方按钮将取消认证此工作流' : '点击下方按钮将认证此工作流'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={certifyMutation.isPending}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={certifyMutation.isPending}>
            {certifyMutation.isPending ? '处理中...' : currentWorkflow.certified ? '取消认证' : '通过认证'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
