/**
 * 工作流组件统一的类型定义
 * 用于避免不同组件中类型定义不一致的问题
 */

import type { Workflow as ApiWorkflow } from '@/web/workflows/types'

/**
 * 工作流卡片显示用的简化类型
 * 从 API 返回的完整 Workflow 类型转换而来
 */
export interface WorkflowCardData {
  id: string // referenceId 转换后的数字
  workflowId: string // 数据库 ID
  slug: string
  title: string // 已根据 locale 本地化
  description: string // 已根据 locale 本地化
  author: string
  imageUrl: string
  categories: string[] // 已根据 locale 本地化
  complexity: string // '初级' | '中级' | '高级'
  /**
   * Raw, untranslated complexity level. `complexity` above is display text, so
   * styling must key off this instead of matching on translated strings.
   */
  complexityKey: 'beginner' | 'intermediate' | 'advanced'
  price: string // '免费' | '付费'
  views: number
  downloads: number
  date: string // ISO date string
  certified: boolean
}

/**
 * 工作流详情页面用的完整类型
 */
export interface WorkflowDetailData {
  id: string // referenceId 转换后的数字
  workflowId: string // 数据库 ID
  title: string // 已根据 locale 本地化
  imageUrl?: string
  description: string // 已根据 locale 本地化
  author: {
    name: string
    username: string
    avatar: string
    verified: boolean
    workflowCount: number
    bio: string
    website: string
    twitter: string
  }
  nodes: string[]
  categories: string[] // 已根据 locale 本地化
  stats: {
    created: string // ISO date string
    updated: string // ISO date string
    downloads: number
    views: number
  }
  workflowUrl: string
  workflowJson: any
  certified: boolean
  price: string // '免费' | '付费'
  complexity: string // '初级' | '中级' | '高级'
  readme: string // 已根据 locale 本地化
}

/**
 * 从 API Workflow 类型转换为 WorkflowCardData
 * @param workflow - API 返回的工作流数据
 * @param locale - 当前语言环境 'zh' | 'en'
 * @param translations - 翻译函数，用于获取复杂度、价格等字段的翻译
 */
export function convertToWorkflowCardData(
  workflow: ApiWorkflow,
  locale: 'zh' | 'en',
  translations?: {
    complexity: (key: 'beginner' | 'intermediate' | 'advanced') => string
    priceType: (key: 'free' | 'paid') => string
  }
): WorkflowCardData {
  // 根据 locale 选择标题和描述
  const title = locale === 'zh' ? workflow.title || workflow.titleEn || '' : workflow.titleEn || workflow.title || ''

  const description =
    locale === 'zh'
      ? workflow.description || workflow.descriptionEn || ''
      : workflow.descriptionEn || workflow.description || ''

  // 根据 locale 选择分类名称
  const categories = (workflow.categories || []).map((c) => (locale === 'zh' ? c.name : c.nameEn || c.name))

  // 转换复杂度 - 使用翻译函数或默认值
  const complexityKey: 'beginner' | 'intermediate' | 'advanced' =
    workflow.complexity === 'beginner'
      ? 'beginner'
      : workflow.complexity === 'advanced'
        ? 'advanced'
        : 'intermediate'

  const complexity = translations
    ? translations.complexity(complexityKey)
    : complexityKey === 'beginner'
      ? locale === 'zh'
        ? '初级'
        : 'Beginner'
      : complexityKey === 'advanced'
        ? locale === 'zh'
          ? '高级'
          : 'Advanced'
        : locale === 'zh'
          ? '中级'
          : 'Intermediate'

  // 转换价格类型 - 使用翻译函数或默认值
  const price = translations
    ? translations.priceType(workflow.priceType)
    : workflow.priceType === 'free'
      ? locale === 'zh'
        ? '免费'
        : 'Free'
      : locale === 'zh'
        ? '付费'
        : 'Paid'

  return {
    id: workflow.referenceId,
    workflowId: workflow.id,
    slug: workflow.slug,
    title,
    description: description || '',
    author: workflow.author?.name || '',
    imageUrl: workflow.imageUrl || '/placeholder.svg',
    categories,
    complexity,
    complexityKey,
    price,
    views: workflow.views,
    downloads: workflow.downloads,
    date:
      workflow.publishedAt?.toISOString().split('T')[0] ??
      workflow.createdAt.toISOString().split('T')[0] ??
      '',
    certified: workflow.certified,
  }
}
