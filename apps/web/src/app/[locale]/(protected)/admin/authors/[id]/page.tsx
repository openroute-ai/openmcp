'use client'

import { ArrowLeft, Bot, Edit, Layers, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils/formatter'
import { Routes } from '@/lib/routes'

const STATUS_LABELS: Record<string, string> = {
  active: '活跃',
  inactive: '未激活',
  suspended: '已暂停',
}

const SKILL_STATUS_LABELS: Record<string, { label: string; variant: 'outline' | 'secondary' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'outline' },
  pending_review: { label: '待审核', variant: 'secondary' },
  scanning: { label: '扫描中', variant: 'secondary' },
  published: { label: '已上架', variant: 'secondary' },
  needs_revision: { label: '需修改', variant: 'outline' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已驳回', variant: 'destructive' },
}

const ASSET_STATUS_LABELS: Record<string, { label: string; variant: 'outline' | 'secondary' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'outline' },
  submitted: { label: '待审核', variant: 'secondary' },
  published: { label: '已上架', variant: 'secondary' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已驳回', variant: 'destructive' },
}

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; variant: 'outline' | 'secondary' | 'destructive' }> }) {
  const config = map[status] || { label: status, variant: 'outline' as const }
  if (config.variant === 'secondary' && status === 'published') {
    return (
      <Badge variant='secondary' className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'>
        {config.label}
      </Badge>
    )
  }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

function SubmissionCard({
  title,
  icon,
  count,
  type,
  items,
}: {
  title: string
  icon: React.ReactNode
  count: number
  type: 'skills' | 'mcpServers' | 'a2aAgents'
  items: any[]
}) {
  const statusMap = type === 'skills' ? SKILL_STATUS_LABELS : ASSET_STATUS_LABELS

  return (
    <Card className='flex h-full flex-col'>
      <CardHeader className='flex flex-row items-center justify-between space-y-0'>
        <CardTitle className='flex items-center gap-2'>
          {icon}
          {title}
        </CardTitle>
        <Badge variant='outline'>{count}</Badge>
      </CardHeader>
      <CardContent className='flex-1'>
        {items.length === 0 ? (
          <p className='py-8 text-center text-sm text-muted-foreground'>暂无提交</p>
        ) : (
          <ul className='space-y-3'>
            {items.map((item) => (
              <li
                key={item.id}
                className='flex items-start justify-between gap-3 rounded-md border p-3'
              >
                <div className='min-w-0'>
                  <div className='truncate font-medium'>{item.title || item.name}</div>
                  <div className='mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-sm'>
                    <StatusBadge status={item.status} map={statusMap} />
                    <span>{item.priceType === 'paid' ? '付费' : '免费'}</span>
                    {type === 'skills' && item.securityGrade && <span>{item.securityGrade}</span>}
                    {item.certified && (
                      <Badge
                        variant='secondary'
                        className='bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                      >
                        已认证
                      </Badge>
                    )}
                  </div>
                </div>
                <div className='shrink-0 text-right text-sm text-muted-foreground'>
                  <div>浏览 {item.views || 0}</div>
                  <div>下载 {item.downloads || 0}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export default function AuthorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const authorId = params.id as string

  const { data: authorData, isLoading } = trpc.admin.authors.getAuthorById.useQuery({ id: authorId })
  const { data: submissionsData, isLoading: isLoadingSubmissions } = trpc.admin.authors.getAuthorSubmissions.useQuery(
    { id: authorId },
    { enabled: !!authorId }
  )

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>加载中...</div>
      </div>
    )
  }

  if (!authorData?.success || !authorData.data) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>
          <p className='text-muted-foreground'>作者不存在</p>
          <Button variant='outline' onClick={() => router.push(Routes.AdminAuthors)} className='mt-4'>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const author = authorData.data
  const submissions = submissionsData?.success ? submissionsData.data : null
  const skillsList = submissions?.skills ?? []
  const mcpList = submissions?.mcpServers ?? []
  const a2aList = submissions?.a2aAgents ?? []
  const links = [
    { label: '网站', href: author.website },
    { label: 'Twitter', href: author.twitter },
    { label: 'LinkedIn', href: author.linkedin },
    { label: 'GitHub', href: author.github },
  ].filter((l): l is { label: string; href: string } => Boolean(l.href))

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='icon' onClick={() => router.push(Routes.AdminAuthors)}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>{author.name}</h1>
            <p className='text-muted-foreground'>作者详情信息</p>
          </div>
        </div>
        <Button variant='outline' onClick={() => router.push(`${Routes.AdminAuthors}?edit=${authorId}`)}>
          <Edit className='mr-2 h-4 w-4' />
          编辑
        </Button>
      </div>

      <div className='grid gap-6 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='flex items-center gap-4'>
              {author.avatar && <img src={author.avatar} alt={author.name} className='h-20 w-20 rounded-full' />}
              <div>
                <div className='font-bold text-2xl'>{author.name}</div>
                <div className='text-muted-foreground'>@{author.username}</div>
              </div>
            </div>

            <div className='space-y-2'>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>状态：</span>
                <Badge variant={author.status === 'active' ? 'default' : 'secondary'} className='ml-2'>
                  {STATUS_LABELS[author.status] ?? author.status}
                </Badge>
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>验证状态：</span>
                {author.verified ? (
                  <Badge variant='default' className='ml-2'>
                    已验证
                  </Badge>
                ) : (
                  <Badge variant='outline' className='ml-2'>
                    未验证
                  </Badge>
                )}
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>工作流数量：</span>
                <span className='ml-2'>{author.workflowCount || 0}</span>
              </div>
            </div>

            {author.description && (
              <div>
                <div className='mb-1 font-medium text-muted-foreground text-sm'>简介</div>
                <p>{author.description}</p>
              </div>
            )}

            {author.bio && (
              <div>
                <div className='mb-1 font-medium text-muted-foreground text-sm'>详细简介</div>
                <p className='whitespace-pre-wrap'>{author.bio}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>联系信息</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {links.length > 0 ? (
              links.map((link) => (
                <div key={link.label}>
                  <span className='font-medium text-muted-foreground text-sm'>{link.label}：</span>
                  <a
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='ml-2 text-primary hover:underline'
                  >
                    {link.href}
                  </a>
                </div>
              ))
            ) : (
              <p className='text-muted-foreground'>暂无联系信息</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>时间信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-2 gap-4'>
            <div>
              <span className='font-medium text-muted-foreground text-sm'>创建时间：</span>
              <span className='ml-2'>{author.createdAt ? formatDateTime(author.createdAt) : '-'}</span>
            </div>
            <div>
              <span className='font-medium text-muted-foreground text-sm'>更新时间：</span>
              <span className='ml-2'>{author.updatedAt ? formatDateTime(author.updatedAt) : '-'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {author.workflowCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>关联工作流 ({author.workflowCount})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground'>
              该作者共有 {author.workflowCount} 个工作流，请在{' '}
              <Link href={`${Routes.AdminWorkflows}?authorId=${authorId}`} className='text-primary hover:underline'>
                工作流管理
              </Link>{' '}
              页面查看详情。
            </p>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className='mb-4 font-bold text-xl tracking-tight'>提交资料</h2>
        {isLoadingSubmissions ? (
          <div className='py-12 text-center text-muted-foreground'>加载提交资料中...</div>
        ) : (
          <div className='grid gap-6 lg:grid-cols-3'>
            <SubmissionCard
              title='Skills'
              icon={<Layers className='h-4 w-4 text-muted-foreground' />}
              count={skillsList.length}
              type='skills'
              items={skillsList}
            />
            <SubmissionCard
              title='MCP Servers'
              icon={<Bot className='h-4 w-4 text-muted-foreground' />}
              count={mcpList.length}
              type='mcpServers'
              items={mcpList}
            />
            <SubmissionCard
              title='A2A Agents'
              icon={<Sparkles className='h-4 w-4 text-muted-foreground' />}
              count={a2aList.length}
              type='a2aAgents'
              items={a2aList}
            />
          </div>
        )}
      </div>
    </div>
  )
}
