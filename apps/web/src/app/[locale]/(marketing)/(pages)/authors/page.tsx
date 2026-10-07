'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { CheckCircle2, Link2, Loader2, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import PaginationBox from '@/components/web/pagination-box'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'

export const dynamic = 'force-dynamic'

function AuthorCard({
  author,
  workflowsText,
  linksText,
}: {
  author: {
    id: string
    name: string
    username: string
    avatar: string | null
    workflowCount: number
    description?: string | null
    hasLinks?: boolean
    verified?: boolean
  }
  workflowsText: string
  linksText: string
}) {
  return (
    <LocaleLink href={`/authors/${author.username}`}>
      <Card className='h-full cursor-pointer transition-shadow duration-300 hover:shadow-md'>
        <CardContent className='p-6'>
          <div className='flex items-start space-x-4'>
            <Avatar className='h-16 w-16 flex-shrink-0'>
              <AvatarImage src={author.avatar ?? undefined} alt={`${author.name}'s avatar`} />
              <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
            </Avatar>

            <div className='min-w-0 flex-1'>
              <div className='mb-1 flex items-center'>
                <h3 className='truncate font-medium text-lg'>{author.name}</h3>
                {author.verified && <CheckCircle2 className='ml-1 h-4 w-4 flex-shrink-0 text-primary' />}
              </div>

              <p className='mb-2 text-muted-foreground text-sm'>@{author.username}</p>

              <div className='mb-3 flex items-center'>
                <Badge variant='secondary' className='font-medium text-xs'>
                  {author.workflowCount} {workflowsText}
                </Badge>
              </div>

              {author.description && (
                <p className='mb-3 line-clamp-3 whitespace-pre-line text-foreground text-sm'>{author.description}</p>
              )}

              {author.hasLinks && (
                <div className='flex items-center text-muted-foreground text-xs'>
                  <Link2 className='mr-1 h-3 w-3' />
                  <span className='truncate'>{linksText}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </LocaleLink>
  )
}

type Author = {
  id: string
  name: string
  username: string
  avatar: string | null
  workflowCount: number
  description?: string | null
  hasLinks?: boolean
  verified?: boolean
}

function AuthorCardSkeleton() {
  return (
    <Card className='h-full'>
      <CardContent className='p-6'>
        <div className='flex items-start space-x-4'>
          <Skeleton className='h-16 w-16 flex-shrink-0 rounded-full' />
          <div className='min-w-0 flex-1 space-y-2'>
            <Skeleton className='h-5 w-32' />
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-6 w-20' />
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-3/4' />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AuthorsPage() {
  const t = useTranslations('AuthorsPage')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const limit = 12

  const { data, isLoading, isFetching } = trpc.authors.getAuthors.useQuery({
    page,
    limit,
    search: search || undefined,
  })

  // 当搜索改变时，重置页码
  useEffect(() => {
    setPage(1)
  }, [search])

  const authors = data?.success && data.data ? data.data : []
  const totalAuthors = data?.pagination?.total ?? 0

  // 区分初始加载和分页加载
  const isInitialLoading = isLoading && !data
  const isPaginationLoading = isFetching && data && !isLoading

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <section className='py-8'>
      <div className='mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-10'>
        {/* Header Section */}
        <div className='mb-8 text-center'>
          <div className='flex flex-wrap items-center justify-center gap-x-3 gap-y-1'>
            <span className='font-bold text-4xl text-primary'>{totalAuthors}</span>
            <h1 className='font-bold text-5xl'>{t('authors')}</h1>
            <span className='text-muted-foreground text-xl'>·</span>
            <h1 className='font-bold text-5xl'>{t('title')}</h1>
          </div>
          <p className='mx-auto mb-4 max-w-3xl text-muted-foreground text-xl'>{t('description')}</p>
        </div>

        {/* Search Section */}
        <div className='mb-8'>
          <div className='relative'>
            <div className='flex items-center'>
              <div className='relative w-full'>
                <Search className='absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform text-muted-foreground' />
                <Input
                  type='text'
                  id='search-input'
                  placeholder={t('searchPlaceholder')}
                  className='w-full pr-10 pl-10'
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 分页加载提示 - 显示在列表顶部，不遮挡视口 */}
        {isPaginationLoading && (
          <div className='mb-4 flex items-center justify-center gap-2 text-muted-foreground text-sm'>
            <Loader2 className='h-4 w-4 animate-spin' />
            <span>{t('loading')}</span>
          </div>
        )}

        {/* 初始加载 - 使用骨架屏 */}
        {isInitialLoading ? (
          <div id='authors-grid' className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
            {Array.from({ length: limit }).map((_, index) => (
              <AuthorCardSkeleton key={index} />
            ))}
          </div>
        ) : (
          <>
            {/* Authors Grid */}
            {authors.length > 0 ? (
              <>
                <div id='authors-grid' className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
                  {authors.map((author) => (
                    <AuthorCard
                      key={author.username}
                      author={author}
                      workflowsText={t('workflows')}
                      linksText={t('authorDetail.hasLinksNote')}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalAuthors > limit && (
                  <div className='mt-8'>
                    <PaginationBox
                      page={page}
                      count={totalAuthors}
                      pageSize={limit}
                      onPageChange={handlePageChange}
                      translations={{
                        previousPage: t('pagination.previousPage'),
                        nextPage: t('pagination.nextPage'),
                      }}
                    />
                  </div>
                )}
              </>
            ) : (
              <div className='flex min-h-[400px] items-center justify-center'>
                <p className='text-lg text-muted-foreground'>{t('noAuthors')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
