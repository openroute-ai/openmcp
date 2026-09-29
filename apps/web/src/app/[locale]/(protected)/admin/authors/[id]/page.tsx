'use client'

import { ArrowLeft, Edit } from 'lucide-react'
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

export default function AuthorDetailPage() {
  const params = useParams()
  const router = useRouter()
  const authorId = params.id as string

  const { data: authorData, isLoading } = trpc.admin.authors.getAuthorById.useQuery({ id: authorId })

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
    </div>
  )
}
