import { getTranslations } from 'next-intl/server'
import type { PropsWithChildren } from 'react'
import { BlogCategoryFilter } from '@/components/blog/blog-category-filter'
import Container from '@/components/layout/container'
import { getAllCategories } from '@/lib/blog/source'

interface BlogListLayoutProps extends PropsWithChildren {
  params: Promise<{ locale: string }>
}

export default async function BlogListLayout({ children, params }: BlogListLayoutProps) {
  const resolvedParams = await params
  const { locale } = resolvedParams
  const t = await getTranslations('BlogPage')

  // Load categories (already filtered by locale in getAllCategories)
  const categoryList = await getAllCategories(locale as string)

  return (
    <div className='mb-section'>
      <div className='mt-10 flex w-full flex-col items-center justify-center gap-6'>
        {/* Header */}
        <div className='max-w-article space-y-3 text-center'>
          <h1 className='text-balance text-center font-bold text-title tracking-tight'>{t('title')}</h1>
          <h2 className='text-pretty text-center font-normal text-lead text-muted-foreground'>{t('subtitle')}</h2>
        </div>

        <BlogCategoryFilter categoryList={categoryList} />
      </div>

      <Container className='mt-10'>{children}</Container>
    </div>
  )
}
