'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { trpc } from '@/lib/trpc/client'
import { CategoriesTable } from './categories-table'
import { CreateCategoryDialog } from './create-category-dialog'
import { DeleteCategoryDialog } from './delete-category-dialog'

export function CategoriesTab() {
  const [selectedCategory, setSelectedCategory] = useState<{ id: string; name: string } | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data: categoriesData, refetch: refetchCategories } = trpc.admin.blog.listCategories.useQuery({})

  const deleteCategoryMutation = trpc.admin.blog.deleteCategory.useMutation({
    onSuccess: () => {
      toast.success('删除成功')
      setSelectedCategory(null)
      setShowDeleteDialog(false)
      refetchCategories()
    },
    onError: (error) => {
      toast.error(error.message || '删除失败')
    },
  })

  const handleDelete = (category: { id: string; name: string }) => {
    setSelectedCategory(category)
    setShowDeleteDialog(true)
  }

  const handleDeleteConfirm = () => {
    if (selectedCategory) {
      deleteCategoryMutation.mutate({ id: selectedCategory.id })
    }
  }

  const handleCreateSuccess = async () => {
    setShowCreateDialog(false)
    await refetchCategories()
    toast.success('创建成功')
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-end'>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className='mr-2 h-4 w-4' />
          创建分类
        </Button>
      </div>

      <CategoriesTable
        data={categoriesData?.success ? categoriesData.data || [] : []}
        onDelete={handleDelete}
        onRefresh={refetchCategories}
      />

      <CreateCategoryDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
      />

      <DeleteCategoryDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        category={selectedCategory}
        onConfirm={handleDeleteConfirm}
        isLoading={deleteCategoryMutation.isPending}
      />
    </div>
  )
}
