'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { trpc } from '@/lib/trpc/client'
import { CategoriesTable } from './categories-table'
import { CreateCategoryDialog } from './create-category-dialog'
import { DeleteCategoryDialog } from './delete-category-dialog'
import PaginationBox from '@/components/web/pagination-box'

export function CategoriesTab() {
  const [selectedCategory, setSelectedCategory] = useState<{ id: string; name: string } | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const { data: categoriesData, refetch: refetchCategories } = trpc.admin.blog.listCategories.useQuery({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  })
  const categories = categoriesData?.success ? categoriesData.data : []
  const categoriesTotal = categoriesData?.success ? (categoriesData.total ?? 0) : 0

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
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {/* 搜索在服务端做：作者/分类表增长后，浏览器端 filter 只能筛到当前这一页 */}
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder='搜索名称或 slug'
          className='max-w-64'
        />
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

      <PaginationBox
        page={page}
        count={categoriesTotal}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
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
