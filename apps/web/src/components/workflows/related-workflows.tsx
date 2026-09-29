'use client'

import { Loader2 } from 'lucide-react'
import { useLocale } from 'next-intl'
import { trpc } from '@/lib/trpc/client'
import { convertToWorkflowCardData } from './types'
import { useTranslations } from 'next-intl'
import { WorkflowCard } from './workflow-card'

interface RelatedWorkflowsProps {
  workflowId: string
}

export function RelatedWorkflows({ workflowId }: RelatedWorkflowsProps) {
  const t = useTranslations('Workflows')
  const locale = useLocale() as 'zh' | 'en'
  const { data, isLoading } = trpc.workflows.getRelatedWorkflows.useQuery({
    workflowId,
    limit: 4,
  })

  if (isLoading) {
    return (
      <section className='mt-12 mb-8'>
        <div className='mb-6'>
          <h2 className='mb-2 font-bold text-2xl text-foreground'>{t('related.title')}</h2>
          <p className='text-muted-foreground'>{t('related.description')}</p>
        </div>
        <div className='flex min-h-[200px] items-center justify-center'>
          <Loader2 className='h-6 w-6 animate-spin text-primary' />
        </div>
      </section>
    )
  }

  if (!data?.success || !data.data || data.data.length === 0) {
    return null
  }

  const workflows = data.data

  // 转换数据格式以匹配 WorkflowCard 组件，根据 locale 本地化字段
  // getRelatedWorkflows 返回的数据结构不完整，需要添加缺失字段的默认值
  const formattedWorkflows = workflows.map((w) => {
    // 创建一个临时的完整 Workflow 对象，添加缺失字段的默认值
    const fullWorkflow = {
      ...w,
      title: w.title || '',
      titleEn: w.titleEn || null,
      description: w.description,
      descriptionEn: w.descriptionEn || null,
      summary: null,
      metaDescription: null,
      authorId: w.author.id,
      workflowUrl: null,
      workflowJson: null,
      readme: null,
      readmeEn: null,
      priceAmount: null,
      currency: null,
      certifiedAt: null,
      verificationCount: 0,
      popularity: 0,
      likes: 0,
      status: 'published' as const,
      updatedAt: w.publishedAt || new Date(),
      createdAt: w.publishedAt || new Date(),
      categories: [], // getRelatedWorkflows 不返回分类数据
      nodeTypes: [], // getRelatedWorkflows 不返回节点类型数据
    }
    return convertToWorkflowCardData(fullWorkflow, locale)
  })

  return (
    <section className='mt-12 mb-8'>
      <div className='mb-6'>
        <h2 className='mb-2 font-bold text-2xl text-foreground'>{t('related.title')}</h2>
        <p className='text-muted-foreground'>{t('related.description')}</p>
      </div>

      <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4'>
        {formattedWorkflows.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} />
        ))}
      </div>
    </section>
  )
}
