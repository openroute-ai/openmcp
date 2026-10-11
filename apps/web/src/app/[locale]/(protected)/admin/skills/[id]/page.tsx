'use client'

import { ArrowLeft, Layers, Loader2, Repeat, ShieldOff, ShieldPlus } from 'lucide-react'
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
  pending_review: { label: '待审核', variant: 'secondary' },
  scanning: { label: '扫描中', variant: 'secondary' },
  published: { label: '已上架', variant: 'secondary' },
  needs_revision: { label: '需修改', variant: 'outline' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已驳回', variant: 'destructive' },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_LABELS[status] || { label: status, variant: 'outline' as const }
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
        : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
  return <Badge variant='outline' className={tone}>{grade}</Badge>
}

export default function SkillDetailPage() {
  const params = useParams()
  const router = useRouter()
  const skillId = params.id as string

  const { data, isLoading } = trpc.admin.skills.getSkillById.useQuery(
    { id: skillId },
    { enabled: !!skillId }
  )

  const [note, setNote] = useState('')

  const reviewMutation = trpc.admin.skills.reviewSkill.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success('审核完成')
        router.push(Routes.AdminSkills)
      } else {
        toast.error(res.error || '审核失败')
      }
    },
    onError: (error) => toast.error(error.message || '审核失败'),
  })

  const certifyMutation = trpc.admin.skills.certifySkill.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success('认证状态已更新')
      else toast.error(res.error || '操作失败')
    },
    onError: (error) => toast.error(error.message || '操作失败'),
  })

  const rescanMutation = trpc.admin.skills.rescanSkill.useMutation({
    onSuccess: (res) => {
      if (res.success) toast.success(`重扫完成，安全评级：${res.grade || '-'}`)
      else toast.error(res.error || '重扫失败')
    },
    onError: (error) => toast.error(error.message || '重扫失败'),
  })

  if (isLoading) {
    return <div className='space-y-6'><div className='py-12 text-center'>加载中...</div></div>
  }

  const skill = data?.success ? data.data : null
  if (!skill) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>
          <p className='text-muted-foreground'>Skill 不存在</p>
          <Button variant='outline' onClick={() => router.push(Routes.AdminSkills)} className='mt-4'>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const flags = Array.isArray(skill.securityFlags) ? skill.securityFlags : []

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='icon' onClick={() => router.push(Routes.AdminSkills)}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='flex items-center gap-2 font-bold text-2xl tracking-tight'>
              <Layers className='size-6 text-primary' />
              {skill.title}
            </h1>
            <p className='text-muted-foreground'>Skill 详情</p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <StatusBadge status={skill.status} />
          {skill.certified ? (
            <Badge variant='secondary' className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'>
              已认证
            </Badge>
          ) : (
            <Badge variant='outline'>未认证</Badge>
          )}
          <SecurityGradeBadge grade={skill.securityGrade} />
          {skill.trustTier != null && <Badge variant='outline'>Tier {skill.trustTier}</Badge>}
        </div>
      </div>

      {skill.status === 'pending_review' && (
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
                onClick={() => reviewMutation.mutate({ id: skill.id, action: 'approve', note: note.trim() })}
              >
                {reviewMutation.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                通过并上架
              </Button>
              <Button
                variant='destructive'
                className='cursor-pointer'
                disabled={reviewMutation.isPending || !note.trim()}
                onClick={() => reviewMutation.mutate({ id: skill.id, action: 'reject', note: note.trim() })}
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
            <Field label='标题'>{skill.title}</Field>
            {skill.titleEn && <Field label='英文标题'>{skill.titleEn}</Field>}
            <Field label='Slug'><span className='font-mono text-sm'>{skill.slug}</span></Field>
            <Field label='Reference'><span className='font-mono text-sm'>{skill.referenceId}</span></Field>
            <Field label='版本'>{skill.version || '-'}</Field>
            <Field label='来源'>
              {skill.sourceType === 'github' ? 'GitHub' : skill.sourceType ? 'ZIP 上传' : '-'}
            </Field>
            {skill.githubUrl && (
              <Field label='GitHub'><a href={skill.githubUrl} target='_blank' rel='noopener noreferrer' className='text-primary hover:underline'>{skill.githubUrl}</a></Field>
            )}
            {skill.category && <Field label='分类'>{skill.category.name || '-'}</Field>}
            {skill.syncedFromConsoleAt && (
              <Field label='同步时间'>{formatDateTime(skill.syncedFromConsoleAt)}</Field>
            )}
            {skill.description && (
              <div>
                <span className='font-medium text-muted-foreground text-sm'>描述：</span>
                <p className='mt-1 text-sm'>{skill.description}</p>
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
              <Field label='价格类型'>{skill.priceType === 'paid' ? '付费' : '免费'}</Field>
              {skill.billingModel && <Field label='计费模式'>{skill.billingModel}</Field>}
              {skill.priceAmount != null && <Field label='售价'>{skill.priceAmount} {skill.currency}</Field>}
              {skill.unitPrice != null && <Field label='单价'>{skill.unitPrice} {skill.currency}</Field>}
              <Field label='浏览/下载/点赞'>{skill.views} / {skill.downloads} / {skill.likes}</Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>作者</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='flex items-center gap-3'>
                {skill.author?.avatar && (
                  <img src={skill.author.avatar} alt={skill.author.name} className='h-10 w-10 rounded-full' />
                )}
                <div>
                  <div className='font-medium'>{skill.author?.name || '-'}</div>
                  <div className='text-muted-foreground text-sm'>@{skill.author?.username}</div>
                </div>
              </div>
              {skill.author?.verified && <Badge variant='default'>已验证</Badge>}
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
              <SecurityGradeBadge grade={skill.securityLevel} />
            </Field>
            <Field label='规则评级'>
              <SecurityGradeBadge grade={skill.securityGrade} />
            </Field>
            {skill.securityLlmGrade && <Field label='LLM 评级'>{skill.securityLlmGrade}</Field>}
            <Field label='扫描时间'>{skill.scannedAt ? formatDateTime(skill.scannedAt) : '从未扫描'}</Field>
            {skill.scanRulesVersion && <Field label='规则版本'>{skill.scanRulesVersion}</Field>}
            {skill.reviewStatus && <Field label='复核状态'>{skill.reviewStatus}</Field>}
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
          {skill.securityLlmAnalysis != null && (
            <div>
              <div className='mb-1 font-medium text-muted-foreground text-sm'>LLM 复核结论</div>
              <pre className='max-h-64 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap'>
                {typeof skill.securityLlmAnalysis === 'string'
                  ? skill.securityLlmAnalysis
                  : JSON.stringify(skill.securityLlmAnalysis, null, 2)}
              </pre>
            </div>
          )}
          {skill.reviewComment && (
            <div>
              <div className='mb-1 font-medium text-muted-foreground text-sm'>最近审核意见</div>
              <p className='text-sm'>{skill.reviewComment}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>内容与元数据</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue='readme'>
            <TabsList>
              <TabsTrigger value='readme'>README</TabsTrigger>
              <TabsTrigger value='features'>功能特性</TabsTrigger>
              <TabsTrigger value='platforms'>平台适配</TabsTrigger>
              <TabsTrigger value='tags'>标签</TabsTrigger>
              <TabsTrigger value='meta'>元数据</TabsTrigger>
            </TabsList>
            <TabsContent value='readme' className='mt-3'>
              {skill.readme ? (
                <pre className='max-h-96 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap'>{skill.readme}</pre>
              ) : (
                <p className='text-sm text-muted-foreground'>无 README</p>
              )}
            </TabsContent>
            <TabsContent value='features' className='mt-3'>
              {skill.features && skill.features.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {skill.features.map((feature) => (
                    <Badge key={feature} variant='outline'>{feature}</Badge>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>无特性关键词</p>
              )}
            </TabsContent>
            <TabsContent value='platforms' className='mt-3'>
              {Array.isArray(skill.platforms) && skill.platforms.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {skill.platforms.map((platform) => (
                    <Badge key={platform} variant='outline'>{platform}</Badge>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>未声明平台适配</p>
              )}
            </TabsContent>
            <TabsContent value='tags' className='mt-3'>
              {skill.tags && skill.tags.length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {skill.tags.map((tag) => (
                    <Badge key={tag} variant='outline'>{tag}</Badge>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>无标签</p>
              )}
            </TabsContent>
            <TabsContent value='meta' className='mt-3 space-y-3'>
              {skill.metadata ? (
                <pre className='max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs'>
                  {JSON.stringify(skill.metadata, null, 2)}
                </pre>
              ) : (
                <p className='text-sm text-muted-foreground'>无</p>
              )}
              <div className='grid gap-3 md:grid-cols-2'>
                <Field label='创建时间'>{formatDateTime(skill.createdAt)}</Field>
                <Field label='更新时间'>{formatDateTime(skill.updatedAt)}</Field>
                <Field label='上架时间'>{skill.publishedAt ? formatDateTime(skill.publishedAt) : '-'}</Field>
                {skill.certifiedAt && <Field label='认证时间'>{formatDateTime(skill.certifiedAt)}</Field>}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          className='cursor-pointer'
          onClick={() => certifyMutation.mutate({ id: skill.id, certified: !skill.certified })}
          disabled={certifyMutation.isPending}
        >
          {skill.certified ? <ShieldOff className='mr-2 h-4 w-4' /> : <ShieldPlus className='mr-2 h-4 w-4' />}
          {skill.certified ? '取消认证' : '标记认证'}
        </Button>
        <Button
          variant='outline'
          className='cursor-pointer'
          onClick={() => rescanMutation.mutate({ id: skill.id })}
          disabled={rescanMutation.isPending}
        >
          <Repeat className='mr-2 h-4 w-4' />
          重跑安全扫描
        </Button>
      </div>
    </div>
  )
}