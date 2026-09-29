import type { Metadata } from 'next'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { workflowsDataAccess } from '@/web/workflows'
import { WorkflowDetailPageClient } from './workflow-detail-page-client'

/**
 * Generate metadata for workflow detail page
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>
}): Promise<Metadata | undefined> {
  const { id } = await params
  const { locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale

  // Try to get workflow by ID first, then by slug
  let workflow = await workflowsDataAccess.getWorkflowById(id, locale)
  if (!workflow) {
    workflow = await workflowsDataAccess.getWorkflowBySlug(id, locale)
  }

  if (!workflow) {
    return constructMetadata({
      title: locale === 'zh' ? '工作流未找到 - 工作流' : 'Workflow Not Found - Workflow',
      description:
        locale === 'zh'
          ? 'Sorry, we could not find information about this workflow.'
          : 'Sorry, we could not find information about this workflow.',
      canonicalUrl: getUrlWithLocale(`/workflows/${id}`, locale),
      locale,
    })
  }

  // Get localized title and description
  const title =
    locale === 'zh'
      ? `${workflow.title || workflow.titleEn || ''} - 工作流`
      : `${workflow.titleEn || workflow.title || ''} - Workflow`

  const description =
    workflow.metaDescription ||
    (locale === 'zh'
      ? workflow.description || workflow.descriptionEn || workflow.summary || ''
      : workflow.descriptionEn || workflow.description || workflow.summary || '') ||
    (locale === 'zh'
      ? `在OpenMCP查看和下载${workflow.title || ''}技能`
      : `View and download ${workflow.titleEn || workflow.title || ''} workflow template on OpenMCP`)

  // Build keywords
  const categoryNames = workflow.categories?.map((c) => (locale === 'zh' ? c.name : c.nameEn || c.name)).join(', ') || ''
  const keywords = [
    workflow.title || workflow.titleEn || '',
    'OpenMCP ClawSourcing skill',
    'OpenClaw',
    'skills',
    'automation',
    categoryNames,
    ...(workflow.nodeTypes || []),
  ].filter(Boolean)

  // Get image URL
  const imageUrl = workflow.imageUrl || '/images/opengraph.png'

  return constructMetadata({
    title,
    description: description.substring(0, 160), // Limit to 160 characters
    canonicalUrl: getUrlWithLocale(`/workflows/${workflow.slug || workflow.id}`, locale),
    image: imageUrl,
    keywords,
    locale,
  })
}

export default function WorkflowDetailPage() {
  return <WorkflowDetailPageClient />
}
