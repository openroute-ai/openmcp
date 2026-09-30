import Container from '@/components/layout/container'
import type { Category } from '@/lib/blog/types'
import { BlogCategoryListDesktop } from './blog-category-list-desktop'
import { BlogCategoryListMobile } from './blog-category-list-mobile'

interface BlogCategoryFilterProps {
  categoryList: Category[]
}

export function BlogCategoryFilter({ categoryList }: BlogCategoryFilterProps) {
  return (
    <section className='w-full'>
      {/* Desktop View, has Container */}
      <Container className='hidden md:block'>
        <BlogCategoryListDesktop categoryList={categoryList} />
      </Container>

      {/* Mobile View, no Container */}
      <div className='block w-full md:hidden'>
        <BlogCategoryListMobile categoryList={categoryList} />
      </div>
    </section>
  )
}
