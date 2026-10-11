'use client'

import { ArrowLeft, Loader2, Repeat, ShieldOff, ShieldPlus, Sparkles } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils/formatter'
import { Routes } from '@/lib/routes'

const STATUS_LABELS: Record<string, { label: string; variant: 'outline' | 'secondary' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'outline' },
  submitted: { label: '待审核', variant: 'secondary' },
  published: { label: '已上架', variant: 'secondary' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已驳回', variant: 'destructive' },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_LABELS[status] || { label: status, variant: 'outline' as const }
  if (status === 'published') {
    return (
      <Badge variant='secondary' className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'>
        {config.label}
      </Badge>
    )
  }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className='font-medium text-muted-foreground text-sm'>{label}：</span>
      <span className='ml-1 break-all'>{children}</span>
    </div>
  )
}

function SecurityGradeBadge({ grade }: { grade?: string | null }) {
  if (!grade) return <span className='text-muted-foreground'>未扫描</span>
  const tone =
    grade === 'safe'
      ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
      : grade === 'caution'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : grade
  return <Badge variant='outline' className={tone}>{grade}</Badge>
}

export default function A2aAgentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const agentId = params.id as string

  const { data, isLoading } = trpc.admin.a2aAgents.getAgentById.useQuery(
    { id: agentId },
    { enabled: !!agentId }
  )

  const [note, setNote] = useState('')

  const reviewMutation = trpc.admin.a2aAgents.reviewAgent.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success('审核完成')
        router.push(Routes.AdminA2aAgents)
      } else {
        toast.error(res.error || '审核失败')
      }
    },
    onError: (error) => toast.error(error.message || '审核失败'),
  })

  const certifyMutation = trpc.admin.a2aAgents.certifyAgent.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success('认证状态已更新')
      else toast.error(res.error || '操作失败')
    },
    onError: (error) => toast.error(error.message || '操作失败'),
  })

  const rescanMutation = trpc.admin.a2aAgents.rescanAgent.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(`重扫完成，安全评级：${res.grade || '-'}`)
      else toast.error(res.error || '重扫失败')
    },
    onError: (error) => toast.error(error.message || '重扫失败'),
  })

  if (isLoading) {
    return <div className='space-y-6'><div className='py-12 text-center'>加载中...</div></div>
  }

  const agent = data?.success ? data.data : null
  if (!agent) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>
          <p className='text-muted-foreground'>A2A 智能体不存在</p>
          <Button variant='outline' onClick={() => router.push(Routes.AdminA2aAgents)} className='mt-4'>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const flags = Array.isArray(agent.securityFlags) ? agent.securityFlags : []

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='icon' onClick={() => router.push(Routes.AdminA2aAgents)}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='flex items-center gap-2 font-bold text-2xl tracking-tight'>
              <Sparkles className='size-6 text-primary' />
              {agent.name}
            </h1>
            <p className='text-muted-foreground'>A2A 智能体详情</p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <StatusBadge status={agent.status} />
          {agent.certified ? (
            <Badge variant='secondary' className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'>
              已认证
            </Badge>
          ) : (
            <Badge variant='outline'>未认证</Badge>
          )}
          <SecurityGradeBadge grade={agent.securityGrade} />
        </div>
      </div>

      {agent.status === 'submitted' && (
        <Card className='border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'>
          <CardHeader>
            <CardTitle>审核操作</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='review-note'>审核意见（驳回时必填）</Label>
              <Input
                id='review-note'
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder='填写审核意见'
                maxLength={500}
              />
            </div>
            <div className='flex gap-2'>
              <Button
                className='cursor-pointer'
                disabled={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate({ id: agent.id, action: 'approve', note: note.trim() })}
              >
                {reviewMutation.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                通过并上架
              </Button>
              <Button
                variant='destructive'
                className='cursor-pointer'
                disabled={reviewMutation.isPending || !note.trim()}
                onClick={() => reviewMutation.mutate({ id: agent.id, action: 'reject', note: note.trim() })}
              >
                驳回
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-6 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Field label='名称'>{agent.name}</Field>
            <Field label='Slug'><span className='font-mono text-sm'>{agent.slug}</span></Field>
            <Field label='Reference'><span className='font-mono text-sm'>{agent.referenceId}</span></Field>
            <Field label='协议版本'>{agent.protocolVersion ?? '-'}</Field>
            <Field label='端点'>{agent.endpoint ? <span className='font-mono text-sm'>{agent.endpoint}</span> : '-'}</Field>
            <Field label='Agent Card'>{agent.agentCardUrl ? <span className='font-mono text-sm'>{agent.agentCardUrl}</span> : '-'}</Field>
            <Field label='网关标识'>{agent.agentName || '-'}</Field>
            <Field label='鉴权方式'>{agent.authType || 'none'}</Field>
            <Field label='可见范围'>{agent.visibility ?? '-'}</Field>
            {agent.category && <Field label='分类'>{agent.category.name || '-'}</Field>}
            {agent.description && (
              <div>
                <span className='font-medium text-muted-foreground text-sm'>描述：</span>
                <p className='mt-1 text-sm'>{agent.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle>价格与统计</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <Field label='价格类型'>{agent.priceType === 'paid' ? '付费' : '免费'}</Field>
              {agent.billingModel && <Field label='计费模式'>{agent.billingModel}</Field>}
              {agent.unitPrice != null && <Field label='单价'>{agent.unitPrice} {agent.currency}</Field>}
              <Field label='浏览/下载'>{agent.views} / {agent.downloads}</Field>
              <Field label='当前版本'>{agent.currentVersion || '-'}</Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>作者</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex items-center gap-3'>
                {agent.author?.avatar && (
                  <img src={agent.author.avatar} alt={agent.author.name} className='h-10 w-10 rounded-full' />
                )}
                <div>
                  <div className='font-medium'>{agent.author?.name || '-'}</div>
                  <div className='text-muted-foreground text-sm'>@{agent.author?.username}</div>
                </div>
              </div>
              {agent.author?.verified && <Badge variant='default'>已验证</Badge>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>安全扫描</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap gap-4'>
            <Field label='展示等级'>
              <SecurityGradeBadge grade={agent.securityLevel} />
            </Field>
            <Field label='规则评级'>
              <SecurityGradeBadge grade={agent.securityGrade} />
            </Field>
            {agent.securityLlmGrade && <Field label='LLM 评级'>{agent.securityLlmGrade}</Field>}
            <Field label='扫描时间'>{agent.scannedAt ? formatDateTime(agent.scannedAt) : '从未扫描'}</Field>
            {agent.scanRulesVersion && <Field label='规则版本'>{agent.scanRulesVersion}</Field>}
          </div>
          {flags.length > 0 && (
            <div>
              <div className='mb-1 font-medium text-muted-foreground text-sm'>命中规则</div>
              <div className='flex flex-wrap gap-2'>
                {(flags as Array<{ name?: string; severity?: string }>).map((flag, index) => (
                  <Badge key={index} variant='outline'>
                    {flag.name ?? '规则'}
                    {flag.severity ? ` (${flag.severity})` : ''}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {agent.securityLlmAnalysis && (
            <div>
              <div className='mb-1 font-medium text-muted-foreground text-sm'>LLM 复核结论</div>
              <p className='text-sm'>{agent.securityLlmAnalysis}</p>
            </div>
          )}
          <div>
            <div className='mb-1 font-medium text-muted-foreground text-sm'>
              Agent Card 能力列表（{agent.skills?.length ?? 0}）
            </div>
            {agent.skills && agent.skills.length > 0 ? (
              <div className='grid gap-2 sm:grid-cols-2'>
                {agent.skills.map((skill, index) => (
                  <div key={index} className='rounded-md border p-2'>
                    <div className='font-mono text-sm'>{skill.name}</div>
                    {skill.description && <div className='text-muted-foreground text-xs'>{skill.description}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>无</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>元数据与时间</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue='meta'>
            <TabsList>
              <TabsTrigger value='meta'>元数据</TabsTrigger>
              <TabsTrigger value='tags'>标签</TabsTrigger>
            </TabsList>
            <TabsContent value='meta' className='mt-3 space-y-3'>
              {agent.metadata ? (
                <pre className='max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs'>
                  {JSON.stringify(agent.metadata, null, 2)}
                </pre>
              ) : (
                <p className='text-sm text-muted-foreground'>无</p>
              )}
              <div className='grid gap-3 md:grid-cols-2'>
                <Field label='创建时间'>{formatDateTime(agent.createdAt)}</Field>
                <Field label='更新时间'>{formatDateTime(agent.updatedAt)}</Field>
                <Field label='上架时间'>{agent.publishedAt ? formatDateTime(agent.publishedAt) : '-'}</Field>
                <Field label='连通状态'>{agent.connectionStatus ?? '-'}</Field>
              </div>
            </TabsContent>
            <TabsContent value='tags' className='mt-3'>
              {agent.tags && agent.tags.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {agent.tags.map((tag) => (
                    <Badge key={tag} variant='outline'>{tag}</Badge>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>无标签</p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          className='cursor-pointer'
          onClick={() => certifyMutation.mutate({ id: agent.id, certified: !agent.certified })}
          disabled={certifyMutation.isPending}
        >
          {agent.certified ? <ShieldOff className='mr-2 h-4 w-4' /> : <ShieldPlus className='mr-2 h-4 w-4' />}
          {agent.certified ? '取消认证' : '标记认证'}
        </Button>
        <Button
          variant='outline'
          className='cursor-pointer'
          onClick={() => rescanMutation.mutate({ id: agent.id })}
          disabled={rescanMutation.isPending}
        >
          <Repeat className='mr-2 h-4 w-4' />
          重跑安全扫描
        </Button>
      </div>
    </div>
  )
}