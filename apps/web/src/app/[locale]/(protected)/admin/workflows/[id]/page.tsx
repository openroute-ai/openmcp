'use client'

import { ArrowLeft, Edit } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils/formatter'
import { Routes } from '@/lib/routes'

const WORKFLOW_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  draft: { label: '草稿', variant: 'secondary' },
  published: { label: '已发布', variant: 'default' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已拒绝', variant: 'destructive' },
}

const COMMENT_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' }> = {
  published: { label: '已发布', variant: 'default' },
  hidden: { label: '已隐藏', variant: 'secondary' },
  deleted: { label: '已删除', variant: 'secondary' },
}

const VERIFICATION_TYPE: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'destructive' }
> = {
  successful: { label: '成功', variant: 'default' },
  partial: { label: '部分成功', variant: 'secondary' },
  failed: { label: '失败', variant: 'destructive' },
}

export default function WorkflowDetailPage() {
  const params = useParams()
  const router = useRouter()
  const workflowId = params.id as string

  const { data: workflowData, isLoading } = trpc.admin.workflows.getWorkflowById.useQuery({ id: workflowId })

  const { data: viewsData } = trpc.admin.workflows.getWorkflowViews.useQuery(
    { workflowId, page: 1, limit: 10 },
    { enabled: Boolean(workflowId) }
  )
  const { data: downloadsData } = trpc.admin.workflows.getWorkflowDownloads.useQuery(
    { workflowId, page: 1, limit: 10 },
    { enabled: Boolean(workflowId) }
  )
  const { data: likesData } = trpc.admin.workflows.getWorkflowLikes.useQuery(
    { workflowId, page: 1, limit: 10 },
    { enabled: Boolean(workflowId) }
  )
  const { data: favoritesData } = trpc.admin.workflows.getWorkflowFavorites.useQuery(
    { workflowId, page: 1, limit: 10 },
    { enabled: Boolean(workflowId) }
  )
  const { data: commentsData } = trpc.admin.workflows.getWorkflowComments.useQuery(
    { workflowId, page: 1, limit: 10 },
    { enabled: Boolean(workflowId) }
  )
  const { data: verificationsData } = trpc.admin.workflows.getWorkflowVerifications.useQuery(
    { workflowId, page: 1, limit: 10 },
    { enabled: Boolean(workflowId) }
  )

  if (isLoading) {
    return <div className='py-12 text-center'>加载中...</div>
  }

  if (!workflowData?.success || !workflowData.data) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>
          <p className='text-muted-foreground'>工作流不存在</p>
          <Button variant='outline' onClick={() => router.push(Routes.AdminWorkflows)} className='mt-4'>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const workflow = workflowData.data

  const statusConfig = WORKFLOW_STATUS[workflow.status] ?? { label: workflow.status, variant: 'outline' as const }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='icon' onClick={() => router.push(Routes.AdminWorkflows)}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>{workflow.title}</h1>
            <p className='text-muted-foreground'>工作流详情信息</p>
          </div>
        </div>
        <Button variant='outline' onClick={() => router.push(`${Routes.AdminWorkflows}?edit=${workflowId}`)}>
          <Edit className='mr-2 h-4 w-4' />
          编辑
        </Button>
      </div>

      <Tabs defaultValue='info' className='space-y-4'>
        <TabsList>
          <TabsTrigger value='info'>基本信息</TabsTrigger>
          <TabsTrigger value='behaviors'>用户行为</TabsTrigger>
        </TabsList>

        <TabsContent value='info' className='space-y-6'>
          <div className='grid gap-6 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>基本信息</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='space-y-2'>
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>标题：</span>
                    <span className='ml-2 font-semibold text-lg'>{workflow.title}</span>
                  </div>
                  {workflow.titleEn && (
                    <div>
                      <span className='font-medium text-muted-foreground text-sm'>英文标题：</span>
                      <span className='ml-2'>{workflow.titleEn}</span>
                    </div>
                  )}
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>标识符：</span>
                    <span className='ml-2 font-mono'>{workflow.slug}</span>
                  </div>
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>引用ID：</span>
                    <span className='ml-2 font-mono'>{workflow.referenceId}</span>
                  </div>
                </div>

                <div className='space-y-2'>
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>状态：</span>
                    <Badge variant={statusConfig.variant} className='ml-2'>
                      {statusConfig.label}
                    </Badge>
                  </div>
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>价格类型：</span>
                    {workflow.priceType === 'paid' ? (
                      <Badge variant='default' className='ml-2'>
                        付费
                      </Badge>
                    ) : (
                      <Badge variant='secondary' className='ml-2'>
                        免费
                      </Badge>
                    )}
                    {workflow.priceAmount && (
                      <span className='ml-2'>
                        {workflow.priceAmount} {workflow.currency}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>复杂度：</span>
                    {workflow.complexity ? (
                      <Badge variant='outline' className='ml-2'>
                        {workflow.complexity}
                      </Badge>
                    ) : (
                      <span className='ml-2'>-</span>
                    )}
                  </div>
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>认证状态：</span>
                    {workflow.certified ? (
                      <Badge variant='default' className='ml-2'>
                        已认证
                      </Badge>
                    ) : (
                      <Badge variant='outline' className='ml-2'>
                        未认证
                      </Badge>
                    )}
                  </div>
                </div>

                {workflow.description && (
                  <div>
                    <div className='mb-1 font-medium text-muted-foreground text-sm'>描述</div>
                    <p>{workflow.description}</p>
                  </div>
                )}

                {workflow.summary && (
                  <div>
                    <div className='mb-1 font-medium text-muted-foreground text-sm'>摘要</div>
                    <p>{workflow.summary}</p>
                  </div>
                )}

                {workflow.imageUrl && (
                  <div>
                    <div className='mb-1 font-medium text-muted-foreground text-sm'>预览图</div>
                    <img src={workflow.imageUrl} alt={workflow.title} className='h-auto max-w-full rounded' />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>关联信息</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div>
                  <span className='font-medium text-muted-foreground text-sm'>作者：</span>
                  {workflow.author ? (
                    <Link
                      href={`${Routes.AdminAuthors}/${workflow.author.id}`}
                      className='ml-2 text-primary hover:underline'
                    >
                      {workflow.author.name}
                    </Link>
                  ) : (
                    <span className='ml-2'>-</span>
                  )}
                </div>

                {workflow.categories && workflow.categories.length > 0 && (
                  <div>
                    <div className='mb-2 font-medium text-muted-foreground text-sm'>分类：</div>
                    <div className='flex flex-wrap gap-2'>
                      {workflow.categories.map((category) => (
                        <Link
                          key={category.id}
                          href={`${Routes.AdminCategories}/${category.id}`}
                          className='text-primary hover:underline'
                        >
                          <Badge variant='outline'>{category.name}</Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {workflow.workflowUrl && (
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>工作流URL：</span>
                    <a
                      href={workflow.workflowUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='ml-2 text-primary hover:underline'
                    >
                      {workflow.workflowUrl}
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>统计信息</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-4 sm:grid-cols-4'>
                <div>
                  <div className='text-muted-foreground text-sm'>浏览次数</div>
                  <div className='font-bold text-2xl'>{workflow.views || 0}</div>
                </div>
                <div>
                  <div className='text-muted-foreground text-sm'>下载次数</div>
                  <div className='font-bold text-2xl'>{workflow.downloads || 0}</div>
                </div>
                <div>
                  <div className='text-muted-foreground text-sm'>点赞数</div>
                  <div className='font-bold text-2xl'>{workflow.likes || 0}</div>
                </div>
                <div>
                  <div className='text-muted-foreground text-sm'>验证次数</div>
                  <div className='font-bold text-2xl'>{workflow.verificationCount || 0}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>时间信息</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <span className='font-medium text-muted-foreground text-sm'>创建时间：</span>
                  <span className='ml-2'>{formatDateTime(workflow.createdAt)}</span>
                </div>
                <div>
                  <span className='font-medium text-muted-foreground text-sm'>更新时间：</span>
                  <span className='ml-2'>{formatDateTime(workflow.updatedAt)}</span>
                </div>
                {workflow.publishedAt && (
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>发布时间：</span>
                    <span className='ml-2'>{formatDateTime(workflow.publishedAt)}</span>
                  </div>
                )}
                {workflow.certifiedAt && (
                  <div>
                    <span className='font-medium text-muted-foreground text-sm'>认证时间：</span>
                    <span className='ml-2'>{formatDateTime(workflow.certifiedAt)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='behaviors' className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle>浏览记录 ({viewsData?.success ? viewsData.pagination.total : 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {viewsData?.success && viewsData.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>IP地址</TableHead>
                      <TableHead>浏览时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewsData.data.map((view) => (
                      <TableRow key={view.id}>
                        <TableCell>{view.user?.name || view.user?.email || '匿名用户'}</TableCell>
                        <TableCell>{view.ipAddress || '-'}</TableCell>
                        <TableCell>{formatDateTime(view.viewedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-muted-foreground'>暂无浏览记录</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>下载记录 ({downloadsData?.success ? downloadsData.pagination.total : 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {downloadsData?.success && downloadsData.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>IP地址</TableHead>
                      <TableHead>下载时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {downloadsData.data.map((download) => (
                      <TableRow key={download.id}>
                        <TableCell>{download.user?.name || download.user?.email || '匿名用户'}</TableCell>
                        <TableCell>{download.ipAddress || '-'}</TableCell>
                        <TableCell>{formatDateTime(download.downloadedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-muted-foreground'>暂无下载记录</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>点赞记录 ({likesData?.success ? likesData.pagination.total : 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {likesData?.success && likesData.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>点赞时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {likesData.data.map((like) => (
                      <TableRow key={like.id}>
                        <TableCell>{like.user?.name || like.user?.email || '匿名用户'}</TableCell>
                        <TableCell>{formatDateTime(like.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-muted-foreground'>暂无点赞记录</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>收藏记录 ({favoritesData?.success ? favoritesData.pagination.total : 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {favoritesData?.success && favoritesData.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>收藏时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {favoritesData.data.map((favorite) => (
                      <TableRow key={favorite.id}>
                        <TableCell>{favorite.user?.name || favorite.user?.email || '匿名用户'}</TableCell>
                        <TableCell>{formatDateTime(favorite.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-muted-foreground'>暂无收藏记录</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>评论记录 ({commentsData?.success ? commentsData.pagination.total : 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {commentsData?.success && commentsData.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>内容</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>评论时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commentsData.data.map((comment) => {
                      const config = COMMENT_STATUS[comment.status] ?? { label: comment.status, variant: 'secondary' as const }
                      return (
                        <TableRow key={comment.id}>
                          <TableCell>{comment.user.name || comment.user.email}</TableCell>
                          <TableCell className='max-w-md truncate'>{comment.content}</TableCell>
                          <TableCell>
                            <Badge variant={config.variant}>{config.label}</Badge>
                          </TableCell>
                          <TableCell>{formatDateTime(comment.createdAt)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-muted-foreground'>暂无评论记录</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>验证记录 ({verificationsData?.success ? verificationsData.pagination.total : 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {verificationsData?.success && verificationsData.data.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>验证类型</TableHead>
                      <TableHead>备注</TableHead>
                      <TableHead>验证时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {verificationsData.data.map((verification) => {
                      const config = VERIFICATION_TYPE[verification.verificationType] ?? {
                        label: verification.verificationType,
                        variant: 'secondary' as const,
                      }
                      return (
                        <TableRow key={verification.id}>
                          <TableCell>{verification.user.name || verification.user.email}</TableCell>
                          <TableCell>
                            <Badge variant={config.variant}>{config.label}</Badge>
                          </TableCell>
                          <TableCell className='max-w-md truncate'>{verification.verificationNote || '-'}</TableCell>
                          <TableCell>{formatDateTime(verification.verifiedAt)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-muted-foreground'>暂无验证记录</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
