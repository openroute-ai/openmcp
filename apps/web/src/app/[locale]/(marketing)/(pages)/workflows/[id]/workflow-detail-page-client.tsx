'use client'

import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { RelatedWorkflows } from '@/components/workflows/related-workflows'
import { ShareWorkflowCard } from '@/components/workflows/share-workflow-card'
import { WorkflowDetailContent } from '@/components/workflows/workflow-detail-content'
import { WorkflowDetailHero } from '@/components/workflows/workflow-detail-hero'
import { WorkflowDetailSidebar } from '@/components/workflows/workflow-detail-sidebar'
import { trpc } from '@/lib/trpc/client'

export function WorkflowDetailPageClient() {
  const t = useTranslations('Workflows')
  const params = useParams()
  const locale = useLocale() as 'zh' | 'en'
  const idOrSlug = params.id as string

  // 尝试根据 ID 获取工作流
  const { data: workflowDataById, isLoading: isLoadingById } = trpc.workflows.getWorkflowById.useQuery(
    { id: idOrSlug },
    {
      retry: false,
    }
  )

  // 如果按 ID 查询失败，尝试按 slug 查询
  const shouldTrySlug = !workflowDataById?.success && !isLoadingById
  const { data: workflowDataBySlug, isLoading: isLoadingBySlug } = trpc.workflows.getWorkflowBySlug.useQuery(
    { slug: idOrSlug },
    {
      enabled: shouldTrySlug,
      retry: false,
    }
  )

  const isLoading = isLoadingById || (shouldTrySlug && isLoadingBySlug)
  const finalWorkflowData = workflowDataById?.success ? workflowDataById : workflowDataBySlug

  // 获取作者详细信息 - 必须在所有早期返回之前调用
  const { data: authorData } = trpc.authors.getAuthorBySlug.useQuery(
    { slug: finalWorkflowData?.success ? finalWorkflowData.data?.author?.username || '' : '' },
    { enabled: !!(finalWorkflowData?.success && finalWorkflowData.data?.author?.username) }
  )

  if (isLoading) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
          <div className='flex min-h-[400px] items-center justify-center'>
            <Loader2 className='h-8 w-8 animate-spin text-primary' />
          </div>
        </div>
      </div>
    )
  }

  if (!finalWorkflowData?.success || !finalWorkflowData.data) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
          <div className='text-center'>
            <h1 className='mb-4 font-bold text-2xl'>{t('notFound.title')}</h1>
            <p className='text-muted-foreground'>{t('notFound.description')}</p>
          </div>
        </div>
      </div>
    )
  }

  // 此时 workflow 一定存在，因为已经通过了上面的检查
  const workflow = finalWorkflowData.data

  // 根据 locale 选择对应的字段
  const localizedTitle =
    locale === 'zh' ? workflow.title || workflow.titleEn || '' : workflow.titleEn || workflow.title || ''

  const localizedDescription =
    locale === 'zh'
      ? workflow.description || workflow.descriptionEn || ''
      : workflow.descriptionEn || workflow.description || ''

  const localizedReadme =
    locale === 'zh' ? workflow.readme || workflow.readmeEn || '' : workflow.readmeEn || workflow.readme || ''

  // 根据 locale 选择分类名称
  const localizedCategories = workflow.categories?.map((c) => (locale === 'zh' ? c.name : c.nameEn || c.name)) || []

  // 转换数据格式以匹配组件期望的格式
  const complexityKey: 'beginner' | 'intermediate' | 'advanced' =
    workflow.complexity === 'beginner'
      ? 'beginner'
      : workflow.complexity === 'advanced'
        ? 'advanced'
        : 'intermediate'

  const formattedWorkflow = {
    id: workflow.id,
    imageUrl: workflow.imageUrl || '/assets/svg/placeholder-workflow.svg',
    workflowId: workflow.id, // 数据库 ID，用于下载
    title: localizedTitle,
    description: localizedDescription,
    author: {
      name: workflow.author.name,
      username: workflow.author.username,
      avatar: workflow.author.avatar || '/placeholder-avatar.svg',
      verified: workflow.author.verified,
      workflowCount: authorData?.success ? authorData.data?.workflowCount || 0 : 0,
      bio: authorData?.success ? authorData.data?.bio || '' : '',
      website: authorData?.success ? authorData.data?.website || '' : '',
      twitter: authorData?.success ? authorData.data?.twitter || '' : '',
    },
    nodes: workflow.nodeTypes || [],
    categories: localizedCategories,
    stats: {
      created: workflow.createdAt.toISOString().split('T')[0] ?? '',
      updated: workflow.updatedAt.toISOString().split('T')[0] ?? '',
      downloads: workflow.downloads,
      views: workflow.views,
    },
    workflowUrl: workflow.workflowUrl || '',
    workflowJson: workflow.workflowJson,
    certified: workflow.certified,
    price: t(workflow.priceType === 'free' ? 'priceType.free' : 'priceType.paid'),
    complexity: t(`complexity.${complexityKey}`),
    readme: localizedReadme,
  }

  return (
    <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
      {/* Breadcrumb and Hero */}
      <WorkflowDetailHero workflow={formattedWorkflow} />

      {/* Main Content Grid */}
      <div className='grid grid-cols-1 gap-8 lg:grid-cols-3'>
        {/* Left Column - Main Content */}
        <div className='lg:col-span-2'>
          <WorkflowDetailContent workflow={formattedWorkflow} />
        </div>

        {/* Right Column - Sidebar */}
        <div className='lg:col-span-1'>
          <WorkflowDetailSidebar workflow={formattedWorkflow} />
          <ShareWorkflowCard />
          {/* <ExpertHireCard /> */}
        </div>
      </div>

      {/* Related Workflows Section */}
      <RelatedWorkflows workflowId={workflow.id} />
    </div>
  )
}
