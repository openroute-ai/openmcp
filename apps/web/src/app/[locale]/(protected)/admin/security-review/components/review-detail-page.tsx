'use client'

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  FileArchiveIcon,
  GitBranchIcon,
  Loader2Icon,
  RotateCwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  Undo2Icon,
  UserIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Label } from '@workspace/ui/components/label'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Textarea } from '@workspace/ui/components/textarea'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils'
import { formatWaiting, toFlags, type ReviewRecord } from '../types'

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
}

const GRADE_CLASS: Record<string, string> = {
  safe: 'text-emerald-600 dark:text-emerald-400',
  caution: 'text-amber-600 dark:text-amber-400',
  unsafe: 'text-orange-600 dark:text-orange-400',
  reject: 'text-destructive',
  unknown: 'text-muted-foreground',
}

type Decision = 'pass' | 'reject' | 'needs_revision'

/** Shape of `security_llm_analysis` jsonb, as written by the scanner. */
interface LlmAnalysis {
  grade?: string
  confidence?: number
  riskSummary?: string
  recommendation?: string
  findings?: { description?: string; mitigation?: string }[]
}

/**
 * Review detail.
 *
 * Loads its own record by id rather than receiving one, so a stale link or a
 * direct URL still renders. The decision form is only offered while the review
 * is undecided; a decided record shows its outcome and offers `restore`
 * instead, because re-deciding an already-decided row would silently rewrite
 * the audit trail instead of appending to it.
 */
export function ReviewDetailPage({ reviewId }: { reviewId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const { data, isLoading, error } = trpc.admin.securityReview.getById.useQuery(
    { id: reviewId },
    { enabled: !!reviewId }
  )

  const { data: historyData } = trpc.admin.securityReview.getBySkillId.useQuery(
    { skillId: data?.success && data.data ? data.data.skillId : '' },
    { enabled: !!data?.success && !!data?.data }
  )

  const [decision, setDecision] = useState<Decision | null>(null)
  const [comment, setComment] = useState('')

  const decideMutation = trpc.admin.securityReview.decide.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('审核决定已提交，创作者已收到通知')
        await utils.admin.securityReview.getQueue.invalidate()
        await utils.admin.securityReview.getStats.invalidate()
        await utils.admin.securityReview.getHistory.invalidate()
        await utils.admin.securityReview.getRejected.invalidate()
        router.push('/admin/security-review')
      } else {
        toast.error(result.error)
      }
    },
    onError: (err) => toast.error(err.message || '提交审核失败'),
  })

  const rescanMutation = trpc.admin.securityReview.rescan.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success(`重新扫描完成，规则评级：${result.data.grade}`)
        await utils.admin.securityReview.getById.invalidate({ id: reviewId })
      } else {
        toast.error(result.error)
      }
    },
    onError: (err) => toast.error(err.message || '重新扫描失败'),
  })

  const restoreMutation = trpc.admin.securityReview.restore.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('已恢复到复核队列')
        await utils.admin.securityReview.getQueue.invalidate()
        await utils.admin.securityReview.getStats.invalidate()
        router.push('/admin/security-review')
      } else {
        toast.error(result.error)
      }
    },
    onError: (err) => toast.error(err.message || '恢复失败'),
  })

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <Skeleton className='h-8 w-64' />
        <div className='grid gap-6 lg:grid-cols-3'>
          <Skeleton className='h-64 w-full' />
          <Skeleton className='h-96 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      </div>
    )
  }

  if (error || !data?.success || !data.data) {
    return (
      <div className='flex flex-col items-center gap-4 py-20'>
        <h1 className='font-bold text-2xl text-destructive'>审核记录未找到</h1>
        <p className='text-muted-foreground'>该记录可能已被清理</p>
        <Button variant='outline' onClick={() => router.push('/admin/security-review')}>
          <ArrowLeftIcon className='mr-2 h-4 w-4' />
          返回队列
        </Button>
      </div>
    )
  }

  const record = data.data as ReviewRecord
  const flags = toFlags(record.flags)
  const analysis = record.analysis as LlmAnalysis | null
  const isDecided = record.decision !== null
  const commentRequired = decision === 'reject' || decision === 'needs_revision'
  const history = (historyData?.success ? historyData.data : []) as ReviewRecord[]

  const submit = () => {
    if (!decision) {
      toast.error('请选择审核决定')
      return
    }
    if (commentRequired && !comment.trim()) {
      toast.error('驳回和要求修改必须填写审核意见')
      return
    }
    decideMutation.mutate({ id: record.id, decision, comment: comment.trim() || undefined })
  }

  return (
    <div className='space-y-6'>
      <div>
        <Link
          href='/admin/security-review'
          className='mb-3 inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
        >
          <ArrowLeftIcon className='size-4' />
          返回队列
        </Link>
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='font-bold text-2xl'>{record.title}</h1>
          <Badge variant='outline'>{record.slug}</Badge>
          {isDecided ? (
            <Badge variant={record.decision === 'pass' ? 'default' : 'destructive'}>
              {record.decision === 'pass' ? '已通过' : record.decision === 'reject' ? '已驳回' : '要求修改'}
            </Badge>
          ) : (
            <Badge variant='destructive'>待复核</Badge>
          )}
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='space-y-4'>
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm'>Skill 基本信息</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <InfoRow
                label='来源'
                value={
                  record.sourceType === 'github' ? (
                    <span className='flex items-center gap-1'>
                      <GitBranchIcon className='size-3.5' />
                      {record.githubUrl ? (
                        <a
                          href={record.githubUrl}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='text-primary hover:underline'
                        >
                          仓库链接
                        </a>
                      ) : (
                        'GitHub'
                      )}
                    </span>
                  ) : (
                    <span className='flex items-center gap-1'>
                      <FileArchiveIcon className='size-3.5' />
                      ZIP 上传
                    </span>
                  )
                }
              />
              <InfoRow
                label='创作者'
                value={
                  <span className='flex items-center gap-1.5'>
                    <UserIcon className='size-3.5 text-muted-foreground' />
                    {record.authorName}
                    <span className='text-muted-foreground text-xs'>@{record.authorUsername}</span>
                  </span>
                }
              />
              <InfoRow
                label='信任层级'
                value={
                  <span
                    className={`font-medium ${
                      (record.trustTier ?? 5) <= 2
                        ? 'text-emerald-600'
                        : record.trustTier === 5
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    }`}
                  >
                    Tier {record.trustTier ?? '-'}
                  </span>
                }
              />
              <InfoRow label='提交时间' value={formatDateTime(record.submittedAt)} />
              <InfoRow
                label='等待时长'
                value={
                  <span className={record.waitingMinutes > 1440 ? 'font-medium text-destructive' : ''}>
                    {formatWaiting(record.waitingMinutes)}
                  </span>
                }
              />
              <InfoRow label='文件数' value={String(record.fileCount)} />
              {record.reviewStatus && <InfoRow label='审核状态' value={record.reviewStatus} />}
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card>
              <CardHeader className='pb-3'>
                <CardTitle className='text-sm'>历史记录（{history.length}）</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                {history.map((item) => (
                  <div key={item.id} className='rounded-lg border p-3 text-sm'>
                    <div className='flex items-center justify-between gap-2'>
                      <Badge variant={item.decision === 'pass' ? 'default' : 'destructive'}>
                        {item.decision === 'pass' ? '通过' : item.decision === 'reject' ? '驳回' : '要求修改'}
                      </Badge>
                      <span className='text-muted-foreground text-xs'>{formatDateTime(item.createdAt)}</span>
                    </div>
                    <p className='mt-1 text-muted-foreground text-xs'>
                      审核人：{item.reviewerName || '系统'}
                      {item.durationMinutes != null && ` · 耗时 ${item.durationMinutes} 分钟`}
                    </p>
                    {item.reviewComment && (
                      <p className='mt-1.5 text-sm'>{item.reviewComment}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className='space-y-4'>
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='flex items-center gap-2 text-sm'>
                <ShieldAlertIcon className='size-4 text-primary' />
                扫描详情
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid grid-cols-2 gap-3'>
                <div className='rounded-lg border p-3'>
                  <p className='text-muted-foreground text-xs'>规则扫描评级</p>
                  <p className={`mt-1 font-bold text-lg ${GRADE_CLASS[record.scanGrade ?? 'unknown']}`}>
                    {(record.scanGrade ?? 'unknown').toUpperCase()}
                  </p>
                </div>
                <div className='rounded-lg border p-3'>
                  <p className='text-muted-foreground text-xs'>LLM 复核评级</p>
                  <p className={`mt-1 font-bold text-lg ${GRADE_CLASS[record.llmGrade ?? 'unknown']}`}>
                    {record.llmGrade?.toUpperCase() ?? '—'}
                  </p>
                </div>
              </div>
              <InfoRow label='规则集版本' value={record.scanRulesVersion || '—'} />
              <InfoRow label='扫描文件数' value={String(record.fileCount)} />
              {isDecided && record.reviewerName && (
                <InfoRow label='审核人' value={record.reviewerName} />
              )}
              {isDecided && record.reviewComment && (
                <div className='rounded-lg border p-3'>
                  <p className='font-medium text-sm'>审核意见</p>
                  <p className='mt-1 text-muted-foreground text-sm'>{record.reviewComment}</p>
                </div>
              )}

              <div>
                <h4 className='mb-2 font-medium text-sm'>命中风险标记（{flags.length}）</h4>
                {flags.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>扫描未命中任何规则</p>
                ) : (
                  <div className='space-y-2'>
                    {flags.map((flag, index) => (
                      <div key={`${flag.name}-${index}`} className='rounded-lg border p-3'>
                        <div className='flex items-center gap-2'>
                          <span
                            className={`rounded px-1.5 py-0.5 font-medium text-xs ${
                              SEVERITY_CLASS[flag.severity] ?? SEVERITY_CLASS.low
                            }`}
                          >
                            {flag.severity}
                          </span>
                          <code className='font-mono font-semibold text-xs'>{flag.name}</code>
                        </div>
                        <p className='mt-1 text-muted-foreground text-sm'>{flag.description}</p>
                        {flag.file && (
                          <div className='mt-2 rounded bg-muted/40 p-2 font-mono text-xs'>
                            <span className='text-muted-foreground'>
                              {flag.file}:{flag.line}{' '}
                            </span>
                            <span>{flag.snippet}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {analysis && (
                <div className='rounded-lg border p-4'>
                  <h4 className='mb-2 flex items-center gap-1.5 font-medium text-sm'>
                    <ShieldCheckIcon className='size-4 text-primary' />
                    LLM 语义复核
                  </h4>
                  {analysis.riskSummary && (
                    <p className='mb-2 text-muted-foreground text-sm'>{analysis.riskSummary}</p>
                  )}
                  <div className='mb-2 flex flex-wrap items-center gap-4 text-muted-foreground text-xs'>
                    {analysis.grade && <span>LLM 评级：{analysis.grade}</span>}
                    {typeof analysis.confidence === 'number' && (
                      <span>置信度：{(analysis.confidence * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  {analysis.findings && analysis.findings.length > 0 && (
                    <div className='space-y-1.5'>
                      {analysis.findings.map((finding, index) => (
                        <div key={index} className='rounded border-primary/30 border-l-2 pl-3 text-sm'>
                          <p className='font-medium'>{finding.description}</p>
                          {finding.mitigation && (
                            <p className='text-muted-foreground text-xs'>{finding.mitigation}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {analysis.recommendation && (
                    <p className='mt-2 text-muted-foreground text-xs'>建议：{analysis.recommendation}</p>
                  )}
                </div>
              )}

              <Button
                variant='outline'
                size='sm'
                className='cursor-pointer'
                onClick={() => rescanMutation.mutate({ id: record.id })}
                disabled={rescanMutation.isPending}
              >
                {rescanMutation.isPending ? (
                  <>
                    <Loader2Icon className='mr-2 size-3.5 animate-spin' />
                    重新扫描中...
                  </>
                ) : (
                  <>
                    <RotateCwIcon className='mr-2 size-3.5' />
                    重新扫描
                  </>
                )}
              </Button>
              <p className='text-muted-foreground text-xs'>重新扫描只更新扫描结果，不会改变审核状态。</p>
            </CardContent>
          </Card>
        </div>

        <div className='space-y-4'>
          <Card>
            <CardHeader className='pb-3'>
              <CardTitle className='text-sm'>{isDecided ? '已完成的审核' : '审核操作'}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              {isDecided ? (
                <>
                  <p className='text-sm'>
                    该记录已于 {formatDateTime(record.createdAt)} 由 {record.reviewerName || '系统'} 处理。
                  </p>
                  <Button
                    variant='outline'
                    className='w-full cursor-pointer'
                    onClick={() => restoreMutation.mutate({ id: record.id })}
                    disabled={restoreMutation.isPending}
                  >
                    <Undo2Icon className='mr-2 h-4 w-4' />
                    恢复到复核队列
                  </Button>
                  <p className='text-muted-foreground text-xs'>
                    恢复会新增一条待处理记录，原有判定保留在历史中。
                  </p>
                </>
              ) : (
                <>
                  <div className='space-y-2'>
                    <Label>审核决定</Label>
                    <div className='space-y-2'>
                      <DecisionButton
                        active={decision === 'pass'}
                        onClick={() => setDecision('pass')}
                        icon={<CheckCircle2Icon className='size-4 text-emerald-600' />}
                        label='通过（标记为误报）'
                        color='emerald'
                      />
                      <DecisionButton
                        active={decision === 'reject'}
                        onClick={() => setDecision('reject')}
                        icon={<ShieldXIcon className='size-4 text-destructive' />}
                        label='驳回（确认风险）'
                        color='destructive'
                      />
                      <DecisionButton
                        active={decision === 'needs_revision'}
                        onClick={() => setDecision('needs_revision')}
                        icon={<AlertTriangleIcon className='size-4 text-amber-600' />}
                        label='要求修改（允许修复重提）'
                        color='amber'
                      />
                    </div>
                  </div>

                  <div className='space-y-1.5'>
                    <Label>
                      审核意见
                      {commentRequired && <span className='text-destructive'> *</span>}
                    </Label>
                    <Textarea
                      rows={5}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      placeholder={
                        decision === 'pass'
                          ? '备注（可选，如「误报：合法安装脚本」）'
                          : decision === 'reject'
                            ? '驳回原因（必填）'
                            : decision === 'needs_revision'
                              ? '修改建议（必填，指出需要修改的文件/行号/内容）'
                              : '请先选择审核决定'
                      }
                    />
                  </div>

                  <Button className='w-full cursor-pointer' onClick={submit} disabled={!decision || decideMutation.isPending}>
                    {decideMutation.isPending ? '提交中...' : '提交审核决定'}
                  </Button>
                  <p className='text-center text-muted-foreground text-xs'>提交后将通知创作者</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-start justify-between gap-2'>
      <span className='shrink-0 text-muted-foreground text-xs'>{label}</span>
      <span className='text-right text-sm'>{value}</span>
    </div>
  )
}

function DecisionButton({
  active,
  onClick,
  icon,
  label,
  color,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  color: 'emerald' | 'destructive' | 'amber'
}) {
  const colorClass = {
    emerald: active ? 'border-emerald-500 bg-emerald-500/5' : '',
    destructive: active ? 'border-destructive bg-destructive/5' : '',
    amber: active ? 'border-amber-500 bg-amber-500/5' : '',
  }[color]

  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:border-primary/40 ${colorClass} ${
        active ? 'border-2' : ''
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
