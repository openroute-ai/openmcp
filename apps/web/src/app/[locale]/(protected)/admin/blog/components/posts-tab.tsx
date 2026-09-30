'use client'

import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { CreatePostDialog } from './create-post-dialog'
import { DeletePostDialog } from './delete-post-dialog'
import { PostsTable } from './posts-table'

export function PostsTab() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [selectedPost, setSelectedPost] = useState<{ id: string; title: string } | null>(null)
  const [filters, setFilters] = useState({
    search: '',
    locale: undefined as string | undefined,
    published: undefined as boolean | undefined,
  })
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const debouncedSearch = useDebounce(filters.search, 500)

  const {
    data: postsData,
    isLoading: isLoadingPosts,
    refetch: refetchPosts,
  } = trpc.admin.blog.listPosts.useQuery({
    filters: {
      search: debouncedSearch || undefined,
      locale: filters.locale,
      published: filters.published,
    },
    pagination: {
      page,
      limit,
    },
  })

  const deletePostMutation = trpc.admin.blog.deletePost.useMutation({
    onSuccess: () => {
      toast.success('删除成功')
      setSelectedPost(null)
      setShowDeleteDialog(false)
      refetchPosts()
    },
    onError: (error) => {
      toast.error(error.message || '删除失败')
    },
  })

  const handleDelete = useCallback((post: { id: string; title: string }) => {
    setSelectedPost(post)
    setShowDeleteDialog(true)
  }, [])

  const handleDeleteConfirm = useCallback(() => {
    if (selectedPost) {
      deletePostMutation.mutate({ id: selectedPost.id })
    }
  }, [selectedPost, deletePostMutation])

  const handleCreateSuccess = useCallback(async () => {
    setShowCreateDialog(false)
    await refetchPosts()
    toast.success('创建成功')
  }, [refetchPosts])

  const handleFiltersChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setPage(1)
  }, [])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handleRefresh = useCallback(async () => {
    await refetchPosts()
  }, [refetchPosts])

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-end'>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className='mr-2 h-4 w-4' />
          创建文章
        </Button>
      </div>

      <PostsTable
        data={postsData?.success ? postsData.data || [] : []}
        pagination={
          postsData?.success
            ? postsData.pagination || {
                page: 1,
                limit: 20,
                total: 0,
                totalPages: 0,
              }
            : {
                page: 1,
                limit: 20,
                total: 0,
                totalPages: 0,
              }
        }
        isLoading={isLoadingPosts}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onPageChange={handlePageChange}
        onRefresh={handleRefresh}
        onDelete={handleDelete}
      />

      <CreatePostDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onSuccess={handleCreateSuccess} />

      <DeletePostDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        post={selectedPost}
        onConfirm={handleDeleteConfirm}
        isLoading={deletePostMutation.isPending}
      />
    </div>
  )
}
