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

export default function CategoryDetailPage() {
  const params = useParams()
  const router = useRouter()
  const categoryId = params.id as string

  const { data: categoryData, isLoading } = trpc.admin.categories.getCategoryById.useQuery({ id: categoryId })

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>加载中...</div>
      </div>
    )
  }

  if (!categoryData?.success || !categoryData.data) {
    return (
      <div className='space-y-6'>
        <div className='py-12 text-center'>
          <p className='text-muted-foreground'>分类不存在</p>
          <Button variant='outline' onClick={() => router.push(Routes.AdminCategories)} className='mt-4'>
            返回列表
          </Button>
        </div>
      </div>
    )
  }

  const category = categoryData.data

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-4'>
          <Button variant='outline' size='icon' onClick={() => router.push(Routes.AdminCategories)}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='font-bold text-2xl tracking-tight'>{category.name}</h1>
            <p className='text-muted-foreground'>分类详情信息</p>
          </div>
        </div>
        <Button variant='outline' onClick={() => router.push(`${Routes.AdminCategories}?edit=${categoryId}`)}>
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
            <div className='space-y-2'>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>中文名称：</span>
                <span className='ml-2 font-semibold text-lg'>{category.name}</span>
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>英文名称：</span>
                <span className='ml-2'>{category.nameEn}</span>
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>标识符：</span>
                <span className='ml-2 font-mono'>{category.slug}</span>
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>引用ID：</span>
                <span className='ml-2 font-mono'>{category.referenceId}</span>
              </div>
            </div>

            <div className='space-y-2'>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>状态：</span>
                {category.isActive ? (
                  <Badge variant='default' className='ml-2'>
                    激活
                  </Badge>
                ) : (
                  <Badge variant='secondary' className='ml-2'>
                    未激活
                  </Badge>
                )}
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>排序：</span>
                <span className='ml-2'>{category.order || 0}</span>
              </div>
              <div>
                <span className='font-medium text-muted-foreground text-sm'>关联工作流：</span>
                <span className='ml-2'>{category.workflowCount || 0}</span>
              </div>
            </div>

            {category.description && (
              <div>
                <div className='mb-1 font-medium text-muted-foreground text-sm'>描述</div>
                <p>{category.description}</p>
              </div>
            )}

            {category.descriptionEn && (
              <div>
                <div className='mb-1 font-medium text-muted-foreground text-sm'>英文描述</div>
                <p>{category.descriptionEn}</p>
              </div>
            )}

            {category.icon && (
              <div>
                <div className='mb-1 font-medium text-muted-foreground text-sm'>图标</div>
                <img src={category.icon} alt={category.name} className='h-12 w-12' />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>时间信息</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <span className='font-medium text-muted-foreground text-sm'>创建时间：</span>
              <span className='ml-2'>{category.createdAt ? formatDateTime(category.createdAt) : '-'}</span>
            </div>
            <div>
              <span className='font-medium text-muted-foreground text-sm'>更新时间：</span>
              <span className='ml-2'>{category.updatedAt ? formatDateTime(category.updatedAt) : '-'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {category.workflowCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>关联工作流 ({category.workflowCount})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground'>
              该分类共有 {category.workflowCount} 个工作流，请在{' '}
              <Link href={`${Routes.AdminWorkflows}?categoryId=${categoryId}`} className='text-primary hover:underline'>
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
