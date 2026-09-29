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
import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc/client'

interface ReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  application: any | null
  onSuccess: () => void
}

const KYC_DOC_LABELS: Record<string, string> = {
  idCardFront: '身份证人像面',
  idCardBack: '身份证国徽面',
  businessLicense: '营业执照',
  legalPersonIdFront: '法人身份证人像面',
  legalPersonIdBack: '法人身份证国徽面',
  authorizationFile: '授权文件',
  authorizerIdFront: '授权人身份证人像面',
  authorizerIdBack: '授权人身份证国徽面',
}

function KycDocsSection({ metadata }: { metadata?: { kycDocuments?: Record<string, string> } | null }) {
  const docs = metadata?.kycDocuments
  if (!docs || Object.keys(docs).length === 0) return null
  const entries = Object.entries(docs).filter(([, url]) => url?.trim())
  if (entries.length === 0) return null

  return (
    <div>
      <Label className='font-medium text-muted-foreground text-sm'>实名认证附件</Label>
      <div className='mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2'>
        {entries.map(([key, url]) => (
          <div key={key} className='rounded-lg border p-3'>
            <p className='mb-2 font-medium text-muted-foreground text-xs'>{KYC_DOC_LABELS[key] || key}</p>
            {/\.(jpe?g|png|webp|gif)$/i.test(url) ? (
              <a href={url} target='_blank' rel='noopener noreferrer'>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={KYC_DOC_LABELS[key] || key}
                  className='max-h-40 w-full rounded border bg-muted object-contain'
                />
              </a>
            ) : (
              <a
                href={url}
                target='_blank'
                rel='noopener noreferrer'
                className='flex items-center gap-2 text-primary text-sm underline underline-offset-4'
              >
                <FileText className='h-4 w-4' />
                查看文件
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReviewDialog({ open, onOpenChange, application, onSuccess }: ReviewDialogProps) {
  const [note, setNote] = useState('')

  useEffect(() => {
    setNote(application?.verificationNote || '')
  }, [application])

  const reviewMutation = trpc.admin.providers.reviewApplication.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.data?.verificationStatus === 'verified' ? '申请已通过，创作者入驻成功' : '申请已驳回')
        onSuccess()
      } else {
        toast.error(data.error || '审核失败')
      }
    },
    onError: (error) => {
      toast.error(error.message || '审核失败')
    },
  })

  const handleReview = (action: 'verify' | 'reject') => {
    if (!application?.id) return
    reviewMutation.mutate({
      id: application.id,
      action,
      note: note || undefined,
    })
  }

  if (!application) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>入驻申请审核</DialogTitle>
          <DialogDescription>审核创作者入驻信息，通过后将为其开通入驻标识</DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          <div className='space-y-4'>
            <div>
              <Label className='font-medium text-muted-foreground text-sm'>申请人</Label>
              <div className='mt-1 font-semibold text-base'>
                {application.author?.name || application.account?.name || '-'}
              </div>
              {application.account?.email && (
                <div className='text-muted-foreground text-sm'>{application.account.email}</div>
              )}
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>主体类型</Label>
                <div className='mt-1 text-sm'>
                  {application.entityType === 'company' ? '企业' : '个人'}
                  {application.companyName ? `（${application.companyName}）` : ''}
                </div>
              </div>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前状态</Label>
                <div className='mt-1'>
                  {application.verificationStatus === 'verified' ? (
                    <Badge
                      variant='secondary'
                      className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                    >
                      已通过
                    </Badge>
                  ) : application.verificationStatus === 'rejected' ? (
                    <Badge variant='destructive'>已驳回</Badge>
                  ) : application.verificationStatus === 'pending' ? (
                    <Badge
                      variant='secondary'
                      className='bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    >
                      待审核
                    </Badge>
                  ) : (
                    <Badge variant='outline'>未提交</Badge>
                  )}
                </div>
              </div>
            </div>

            {application.contactName && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>联系人</Label>
                <div className='mt-1 text-sm'>{application.contactName}</div>
              </div>
            )}

            <div>
              <Label className='font-medium text-muted-foreground text-sm'>收款通道</Label>
              <div className='mt-1 text-sm'>
                {application.payChannelType === 'wechat'
                  ? '微信支付'
                  : application.payChannelType === 'alipay'
                    ? '支付宝'
                    : '未开通'}
                {application.payChannelStatus === 'ready'
                  ? '（可用）'
                  : `（${application.payChannelStatus || '未连接'}）`}
                {application.payChannelNote && (
                  <div className='text-muted-foreground'>{application.payChannelNote}</div>
                )}
              </div>
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>提交时间</Label>
                <div className='mt-1 text-sm'>
                  {application.createdAt ? format(new Date(application.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
                </div>
              </div>
              {application.verifiedAt && (
                <div>
                  <Label className='font-medium text-muted-foreground text-sm'>审核时间</Label>
                  <div className='mt-1 text-sm'>{format(new Date(application.verifiedAt), 'yyyy-MM-dd HH:mm')}</div>
                </div>
              )}
            </div>

            {application.documentationUrl && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>资质/证明文档</Label>
                <div className='mt-1 text-primary text-sm'>{application.documentationUrl}</div>
              </div>
            )}

            <KycDocsSection metadata={application.metadata} />

            {application.verificationNote && (
              <div>
                <Label className='font-medium text-muted-foreground text-sm'>当前审核备注</Label>
                <div className='mt-1 rounded-md bg-muted p-2 text-sm'>{application.verificationNote}</div>
              </div>
            )}
          </div>

          <div className='space-y-4 border-t pt-4'>
            <div>
              <Label htmlFor='review-note'>审核备注</Label>
              <Textarea
                id='review-note'
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
                  通过后创作者将获得入驻标识；驳回后创作者可修改资料后重新提交审核
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
            {reviewMutation.isPending ? '处理中...' : '驳回申请'}
          </Button>
          <Button onClick={() => handleReview('verify')} disabled={reviewMutation.isPending}>
            {reviewMutation.isPending ? '处理中...' : '通过审核'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
