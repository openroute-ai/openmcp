import { Skeleton } from '@workspace/ui/components/skeleton'
import Image from 'next/image'
import { LocaleLink } from '@/i18n/navigation'
import type { ExtendedPost } from '@/lib/blog/types'
import { formatDate } from '@/lib/utils'

// 源项目从 `@/lib/constants` 导入；目标项目无该常量，内联同源占位图。
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg=='

interface BlogCardProps {
  post: ExtendedPost
}

export default function BlogCard({ post }: BlogCardProps) {
  const publishDate = post.date
  const date = formatDate(new Date(publishDate))

  // Extract the slug parts for the Link component
  const slugParts = post.slugAsParams.split('/')
  // console.log('BlogCard, slugParts', slugParts);

  return (
    <LocaleLink href={`/blog/${slugParts.join('/')}`} className='block h-full'>
      <div className='group flex h-full flex-col overflow-hidden rounded-lg border'>
        {/* Image container - fixed aspect ratio */}
        <div className='group relative aspect-16/9 w-full overflow-hidden'>
          {post.image && (
            <div className='relative h-full w-full'>
              <Image
                src={post.image}
                alt={post.title || 'image for blog post'}
                title={post.title || 'image for blog post'}
                className='object-cover transition-transform duration-300 hover:scale-105'
                placeholder='blur'
                blurDataURL={PLACEHOLDER_IMAGE}
                fill
              />

              {post.categories && post.categories.length > 0 && (
                <div className='absolute bottom-2 left-2 opacity-100 transition-opacity duration-300'>
                  <div className='flex flex-wrap gap-1'>
                    {post.categories.map((category, index) => (
                      <span
                        key={`${category?.slug}-${index}`}
                        className='rounded-md bg-black bg-opacity-50 px-2 py-1 font-medium text-white text-xs'
                      >
                        {category?.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Post info container */}
        <div className='flex flex-1 flex-col justify-between p-5'>
          <div>
            {/* Post title */}
            <h3 className='line-clamp-2 font-medium text-subsection'>
              <span className='bg-[length:0px_10px] bg-left-bottom bg-linear-to-r from-green-200 to-green-100 bg-no-repeat transition-[background-size] duration-500 hover:bg-[length:100%_3px] group-hover:bg-[length:100%_10px] dark:from-purple-800 dark:to-purple-900'>
                {post.title}
              </span>
            </h3>

            {/* Post excerpt */}
            <div className='mt-2'>
              {post.description && <p className='line-clamp-2 text-muted-foreground text-small'>{post.description}</p>}
            </div>
          </div>

          {/* Author and date */}
          <div className='mt-5 flex items-center justify-between space-x-4 border-t pt-4 text-muted-foreground'>
            <div className='flex items-center gap-2'>
              <div className='relative h-8 w-8 shrink-0'>
                {post?.author?.avatar && (
                  <Image
                    src={post?.author?.avatar}
                    alt={`avatar for ${post?.author?.name}`}
                    className='rounded-full border object-cover'
                    fill
                  />
                )}
              </div>
              <span className='truncate text-small'>{post?.author?.name}</span>
            </div>

            <time className='truncate text-small' dateTime={date}>
              {date}
            </time>
          </div>
        </div>
      </div>
    </LocaleLink>
  )
}

export function BlogCardSkeleton() {
  return (
    <div className='h-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800'>
      <div className='relative aspect-16/9 w-full overflow-hidden'>
        <Image src={PLACEHOLDER_IMAGE} alt='Loading placeholder' className='object-cover' fill />
      </div>
      <div className='flex flex-1 flex-col justify-between p-5'>
        <div>
          <Skeleton className='mb-2 h-6 w-full' />
          <Skeleton className='mb-4 h-4 w-full' />
        </div>
        <div className='flex items-center justify-between gap-2 border-gray-100 border-t pt-4 dark:border-gray-800'>
          <div className='flex items-center gap-2'>
            <Skeleton className='h-8 w-8 rounded-full' />
            <Skeleton className='h-4 w-24' />
          </div>
          <Skeleton className='h-4 w-20' />
        </div>
      </div>
    </div>
  )
}
