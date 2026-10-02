'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import PaginationBox from '@/components/web/pagination-box'
import { trpc } from '@/lib/trpc/client'
import { AuthorsTable } from './authors-table'
import { CreateAuthorDialog } from './create-author-dialog'
import { DeleteAuthorDialog } from './delete-author-dialog'

export function AuthorsTab() {
  const [selectedAuthor, setSelectedAuthor] = useState<{ id: string; name: string } | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const { data: authorsData, refetch: refetchAuthors } = trpc.admin.blog.listAuthors.useQuery({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  })
  const authors = authorsData?.success ? authorsData.data : []
  const authorsTotal = authorsData?.success ? (authorsData.total ?? 0) : 0

  const deleteAuthorMutation = trpc.admin.blog.deleteAuthor.useMutation({
    onSuccess: () => {
      toast.success('删除成功')
      setSelectedAuthor(null)
      setShowDeleteDialog(false)
      refetchAuthors()
    },
    onError: (error) => {
      toast.error(error.message || '删除失败')
    },
  })

  const handleDelete = (author: { id: string; name: string }) => {
    setSelectedAuthor(author)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = () => {
    if (selectedAuthor) {
      deleteAuthorMutation.mutate({ id: selectedAuthor.id })
    }
  }

  const onRefreshClick = async () => {
    await refetchAuthors()
  }

  const handleCreateSuccess = async () => {
    setShowCreateDialog(false)
    await refetchAuthors()
    toast.success('创建成功')
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {/* 搜索在服务端做：作者表增长后，浏览器端 filter 只能筛到当前这一页 */}
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder='搜索作者名称或 slug'
          className='max-w-64'
        />
        <div className='flex items-center gap-2'>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className='mr-2 h-4 w-4' />
          创建作者
        </Button>
        <Button variant='outline' size='icon' onClick={onRefreshClick}>
          <RefreshCw className='h-4 w-4' />
        </Button>
        </div>
      </div>

      <AuthorsTable
        data={authorsData?.success ? authorsData.data || [] : []}
        onDelete={handleDelete}
        onRefresh={refetchAuthors}
      />

      <PaginationBox
        page={page}
        count={authorsTotal}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />

      <CreateAuthorDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onSuccess={handleCreateSuccess} />

      <DeleteAuthorDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        author={selectedAuthor}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteAuthorMutation.isPending}
      />
    </div>
  )
}
