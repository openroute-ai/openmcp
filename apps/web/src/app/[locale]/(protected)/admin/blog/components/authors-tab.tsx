'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { trpc } from '@/lib/trpc/client'
import { AuthorsTable } from './authors-table'
import { CreateAuthorDialog } from './create-author-dialog'
import { DeleteAuthorDialog } from './delete-author-dialog'

export function AuthorsTab() {
  const [selectedAuthor, setSelectedAuthor] = useState<{ id: string; name: string } | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data: authorsData, refetch: refetchAuthors } = trpc.admin.blog.listAuthors.useQuery({})

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
      <div className='flex items-center justify-end gap-4'>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className='mr-2 h-4 w-4' />
          创建作者
        </Button>
        <Button variant='outline' size='icon' onClick={onRefreshClick}>
          <RefreshCw className='h-4 w-4' />
        </Button>
      </div>

      <AuthorsTable
        data={authorsData?.success ? authorsData.data || [] : []}
        onDelete={handleDelete}
        onRefresh={refetchAuthors}
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
