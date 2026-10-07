'use client'

import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import { SkillDetailContent } from '@/components/skills/skill-detail-content'
import { SkillDetailHero } from '@/components/skills/skill-detail-hero'
import { SkillDetailSidebar } from '@/components/skills/skill-detail-sidebar'
import { SkillPurchase } from '@/components/skills/skill-purchase'
import { trpc } from '@/lib/trpc/client'

export function SkillDetailPageClient() {
  const t = useTranslations('SkillPage.detail')
  const params = useParams()
  const lang = useLocale() === 'zh' ? 'zh' : 'en'
  const idOrSlug = params.id as string

  const { data: byId, isLoading: loadingById } = trpc.skills.getSkillById.useQuery(
    { id: idOrSlug },
    { retry: false }
  )
  const shouldTrySlug = !loadingById && !byId?.success
  const { data: bySlug, isLoading: loadingBySlug } = trpc.skills.getSkillBySlug.useQuery(
    { slug: idOrSlug },
    { enabled: shouldTrySlug, retry: false }
  )

  const isLoading = loadingById || (shouldTrySlug && loadingBySlug)
  const resolved = byId?.success ? byId : bySlug

  if (isLoading) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
          <div className='flex min-h-[400px] items-center justify-center'>
            <Loader2 className='size-8 animate-spin text-primary' />
          </div>
        </div>
      </div>
    )
  }

  if (!resolved?.success || !resolved.data) {
    return (
      <div className='pt-16'>
        <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
          <div className='text-center'>
            <h1 className='mb-4 font-bold text-2xl'>{t('notFoundHeading')}</h1>
            <p className='text-muted-foreground'>{t('notFoundHint')}</p>
          </div>
        </div>
      </div>
    )
  }

  const skill = resolved.data
  const description = skill.description ?? ''
  const platforms = Array.isArray(skill.platforms)
    ? skill.platforms.map((p) => String(p)).filter(Boolean)
    : []

  return (
    <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
      <SkillDetailHero
        skill={{
          id: skill.id,
          title: skill.title,
          slug: skill.slug,
          imageUrl: skill.imageUrl,
          description,
          certified: skill.certified,
          securityGrade: skill.securityGrade,
          priceType: skill.priceType,
          priceAmount: skill.priceAmount,
          currency: skill.currency ?? 'CNY',
          platforms,
          views: skill.views,
          downloads: skill.downloads,
          version: skill.version,
        }}
      />
      <div className='grid grid-cols-1 gap-8 lg:grid-cols-3'>
        <div className='lg:col-span-2 space-y-8'>
          <SkillDetailContent
            skill={{
              description,
              readme: skill.readme,
              scenario: skill.scenario,
              features: skill.features,
              securityGrade: skill.securityGrade,
              securityFlags: skill.securityFlags,
              securityLlmAnalysis: skill.securityLlmAnalysis,
              evalReport: skill.evalReport,
              trustTier: skill.trustTier,
              certified: skill.certified,
            }}
          />
        </div>
        <div className='lg:col-span-1'>
          <div className='space-y-6 lg:sticky lg:top-24'>
            <SkillPurchase
              skillId={skill.id}
              skillSlug={skill.slug}
              skillTitle={skill.title}
              priceType={skill.priceType}
              priceAmount={skill.priceAmount}
              currency={skill.currency ?? 'CNY'}
              billingModel={skill.billingModel}
              securityGrade={skill.securityGrade}
            />
            <SkillDetailSidebar
              skill={{
                author: skill.author,
                category: skill.category
                  ? {
                      name: lang === 'zh' ? skill.category.name : skill.category.nameEn || skill.category.name,
                      slug: skill.category.slug,
                    }
                  : null,
                certified: skill.certified,
                priceType: skill.priceType,
                priceAmount: skill.priceAmount,
                currency: skill.currency ?? 'CNY',
                billingModel: skill.billingModel,
                version: skill.version,
                sourceType: skill.sourceType,
                githubUrl: skill.githubUrl,
                stats: {
                  created: skill.createdAt.toISOString().split('T')[0] ?? '',
                  updated: (skill.updatedAt ?? skill.createdAt).toISOString().split('T')[0] ?? '',
                  views: skill.views,
                  downloads: skill.downloads,
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
