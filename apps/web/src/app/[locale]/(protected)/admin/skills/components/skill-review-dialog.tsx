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
import { trpc } from '@/lib/trpc/client'

interface SkillReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: any | null
  onSuccess: () => void
}

const STATUS_MAP: Record<string, string> = {
  draft: '草稿',
  pending_review: '待审核',
  scanning: '扫描中',
  published: '已上架',
  needs_revision: '需修改',
  archived: '已归档',
  rejected: '已驳回',
}

export function SkillReviewDialog({ open, onOpenChange, skill, onSuccess }: SkillReviewDialogProps) {
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote(skill?.reviewComment || '')
  }, [skill])

  const reviewMutation = trpc.admin.skills.reviewSkill.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success('审核完成，Skill 已处理')
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
    if (!skill?.id) return
    reviewMutation.mutate({
      id: skill.id,
      action,
      note: note || undefined,
    })
  }

  if (!skill) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>审核 Skill</DialogTitle>
          <DialogDescription>通过后将上架到 Skills 货架，驳回将返回作者修改</DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          <div className='space-y-4'>
            <div>
              <Label className='font-medium text-muted-foreground text-sm'>标题</Label>
              <div className='mt-1 font-semibold text-base'>{skill.title}</div>
              {skill.slug && <div className='mt-0.5 text-muted-foreground text-sm'>{skill.slug}</div>}
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前状态</Label>
                <div className='mt-1'>
                  <Badge variant={skill.status === 'published' ? 'default' : 'outline'}>
                    {STATUS_MAP[skill.status] || skill.status || '-'}
                  </Badge>
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>作者</Label>
                <div className='mt-1 text-sm'>
                  {skill.author?.name || '-'}
                  {skill.author?.verified ? '（已认证）' : ''}
                </div>
              </div>
            </div>

            {skill.description && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>描述</Label>
                <div className='mt-1 text-sm'>{skill.description}</div>
              </div>
            )}

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>来源</Label>
                <div className='mt-1 text-sm'>
                  {skill.sourceType ? skill.sourceType.toUpperCase() : '-'}
                  {skill.githubUrl && (
                    <a
                      href={skill.githubUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='ml-1 text-sm text-blue-600 underline'
                    >
                      {skill.githubUrl}
                    </a>
                  )}
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>价格</Label>
                <div className='mt-1 text-sm'>
                  {skill.priceType === 'paid'
                    ? `付费${skill.unitPrice ? ` ${skill.unitPrice} ${skill.currency || 'CNY'}` : ''}`
                    : '免费'}
                </div>
              </div>
            </div>

            <div className='grid grid-cols-3 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>安全评级</Label>
                <div className='mt-1'>
                  <Badge variant='outline'>{skill.securityGrade || '-'}</Badge>
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>下载</Label>
                <div className='mt-1 font-semibold text-lg'>{skill.downloads || 0}</div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>创建时间</Label>
                <div className='mt-1 text-sm'>
                  {skill.createdAt ? format(new Date(skill.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                </div>
              </div>
            </div>

            {skill.reviewComment && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前审核备注</Label>
                <div className='mt-1 rounded-md bg-muted p-2 text-sm'>{skill.reviewComment}</div>
              </div>
            )}
          </div>

          <div className='space-y-4 border-t pt-4'>
            <div>
              <Label htmlFor='skill-review-note'>审核备注</Label>
              <Textarea
                id='skill-review-note'
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
                  通过并上架后 Skill 将对用户可见；驳回后作者可修改后重新提交审核
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