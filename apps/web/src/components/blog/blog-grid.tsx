import BlogCard, { BlogCardSkeleton } from '@/components/blog/blog-card'
import type { ExtendedPost } from '@/lib/blog/types'
import { websiteConfig } from '@/lib/config/website'

interface BlogGridProps {
  posts: ExtendedPost[]
}

export default function BlogGrid({ posts }: BlogGridProps) {
  // console.log('BlogGrid, posts', posts);
  return (
    <div>
      {posts?.length > 0 && (
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
          {posts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

export function BlogGridSkeleton({ count = websiteConfig.blog.paginationSize }: { count?: number }) {
  return (
    <div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
      {[...Array(count)].map((_, index) => (
        <BlogCardSkeleton key={index} />
      ))}
    </div>
  )
}
