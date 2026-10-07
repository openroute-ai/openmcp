'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'

export const dynamic = 'force-dynamic'

export default function CategoriesPage() {
  const t = useTranslations('CategoriesPage')
  const locale = useLocale() as 'zh' | 'en'
  const { data, isLoading, error } = trpc.categories.getAllCategories.useQuery()

  if (isLoading) {
    return (
      <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
        <div className='flex min-h-[400px] items-center justify-center'>
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
        </div>
      </div>
    )
  }

  if (error || !data?.success) {
    return (
      <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
        <div className='text-center'>
          <p className='text-destructive'>{t('loadError')}</p>
        </div>
      </div>
    )
  }

  const categories = data.data || []

  // 根据 locale 选择分类名称（虽然服务端已处理，但客户端也处理以确保正确）
  const getCategoryName = (category: (typeof categories)[number]) => {
    if (locale === 'zh') {
      return category.name || category.nameEn || ''
    }
    return category.nameEn || category.name || ''
  }

  return (
    <div className='mx-auto w-full max-w-7xl px-5 py-10 sm:px-6 lg:px-10'>
      {/* Header Section */}
      <div className='mb-8'>
        <LocaleLink href='/' className='mb-4 inline-flex items-center gap-1 text-primary hover:text-primary/80'>
          <ArrowLeft className='h-4 w-4' />
          <span>{t('backToCatalog')}</span>
        </LocaleLink>
        <h1 className='mb-4 font-bold text-5xl'>{t('title')}</h1>
        <p className='mb-8 text-lg text-muted-foreground'>{t('description')}</p>
      </div>

      {/* Categories Grid */}
      <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {categories.map((category) => (
          <LocaleLink key={category.id} href={`/categories/${category.slug}`}>
            <Card className='h-full cursor-pointer transition-shadow hover:shadow-md'>
              <CardHeader className='pb-2'>
                <div className='flex items-center justify-between'>
                  <CardTitle className='font-semibold text-xl'>{getCategoryName(category)}</CardTitle>
                  <Badge variant='secondary'>{category.workflowCount}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className='text-muted-foreground text-sm'>
                  {category.workflowCount} {category.workflowCount === 1 ? t('workflow') : t('workflows')}
                </p>
              </CardContent>
            </Card>
          </LocaleLink>
        ))}
      </div>
    </div>
  )
}
