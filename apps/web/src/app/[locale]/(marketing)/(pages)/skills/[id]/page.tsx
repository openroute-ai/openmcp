import type { Metadata } from 'next'
import { isLocale } from '@/i18n/routing'
import { constructMetadata } from '@/lib/metadata'
import { getUrlWithLocale } from '@/lib/urls/urls'
import { skillsDataAccess } from '@/web/skills'
import { SkillDetailPageClient } from './skill-detail-page-client'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>
}): Promise<Metadata | undefined> {
  const { id, locale: rawLocale } = await params
  if (!isLocale(rawLocale)) return undefined
  const locale = rawLocale

  const skill =
    (await skillsDataAccess.getSkillById(id, locale === 'zh' ? 'zh' : 'en')) ??
    (await skillsDataAccess.getSkillBySlug(id, locale === 'zh' ? 'zh' : 'en'))

  if (!skill) {
    return constructMetadata({
      title: locale === 'zh' ? '技能未找到' : 'Skill not found',
      description:
        locale === 'zh'
          ? '抱歉，找不到该技能的信息。'
          : 'Sorry, we could not find this skill.',
      canonicalUrl: getUrlWithLocale(`/skills/${id}`, locale),
      locale,
    })
  }

  const description = (skill.description || skill.summary || '').substring(0, 160)
  return constructMetadata({
    title:
      locale === 'zh'
        ? `${skill.title} - Skills 仓库`
        : `${skill.title} - Skills Repository`,
    description:
      description ||
      (locale === 'zh'
        ? `查看并获取技能 ${skill.title}`
        : `View and acquire skill ${skill.title}`),
    canonicalUrl: getUrlWithLocale(`/skills/${skill.slug || skill.id}`, locale),
    image: skill.imageUrl ?? undefined,
    keywords: ['Skills', 'AI', skill.title],
    locale,
  })
}

export default function SkillDetailPage() {
  return <SkillDetailPageClient />
}
