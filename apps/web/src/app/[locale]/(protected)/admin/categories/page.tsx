'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { CategoryTable } from './components/category-table'
import { CreateCategoryDialog } from './components/create-category-dialog'
import { UpdateCategoryDialog } from './components/update-category-dialog'

export default function CategoriesPage() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [categories, setCategories] = useState<any[]>([])
  const [selectedCategory, setSelectedCategory] = useState<any | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    workflowCount: 0,
  })
  const [pagination, setPagination] = useState<any>(null)
  const [filters, setFilters] = useState({
    search: '',
    isActive: undefined as boolean | undefined,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  const debouncedSearch = useDebounce(filters.search, 500)

  const {
    data: categoriesData,
    isLoading: isLoadingCategories,
    refetch: refetchCategories,
  } = trpc.admin.categories.getCategoriesPaginated.useQuery({
    page,
    limit,
    search: debouncedSearch || undefined,
    isActive: filters.isActive,
  })

  const { data: statsData, isLoading: isLoadingStatsData } = trpc.admin.categories.getCategoryStats.useQuery()

  useEffect(() => {
    if (categoriesData?.success) {
      setCategories(categoriesData.data || [])
      setPagination(categoriesData.pagination || null)
    } else if (categoriesData?.error) {
      toast.error(categoriesData.error)
    }
    setIsLoading(isLoadingCategories)
  }, [categoriesData, isLoadingCategories])

  useEffect(() => {
    if (statsData?.success) {
      setStats({
        total: statsData.data?.total ?? 0,
        active: statsData.data?.active ?? 0,
        inactive: statsData.data?.inactive ?? 0,
        workflowCount: statsData.data?.workflowCount ?? 0,
      })
    } else if (statsData?.error) {
      toast.error(statsData.error)
    }
    setIsLoadingStats(isLoadingStatsData)
  }, [statsData, isLoadingStatsData])

  const { refetch: refetchStats } = trpc.admin.categories.getCategoryStats.useQuery()

  const handleUpdate = useCallback((category: any) => {
    setSelectedCategory(category)
    setShowUpdateDialog(true)
  }, [])

  const handleCreateSuccess = useCallback(async () => {
    setShowCreateDialog(false)
    await Promise.all([refetchCategories(), refetchStats()])
  }, [refetchCategories, refetchStats])

  const handleFiltersChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setPage(1)
  }, [])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchCategories(), refetchStats()])
  }, [refetchCategories, refetchStats])

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>分类管理</h1>
          <p className='text-muted-foreground'>管理系统中的所有分类，包括分类信息和状态管理</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={handleRefresh}>
            <RefreshCw className='mr-2 h-4 w-4' />
            刷新
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className='mr-2 h-4 w-4' />
            创建分类
          </Button>
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>总分类数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>激活</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.active || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>未激活</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.inactive || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>关联工作流</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.workflowCount || 0}</div>
          </CardContent>
        </Card>
      </div>

      <CategoryTable
        data={categories}
        pagination={
          pagination || {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0,
          }
        }
        isLoading={isLoading}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onPageChange={handlePageChange}
        onRefresh={handleRefresh}
        onUpdate={handleUpdate}
      />

      <CreateCategoryDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
      />

      <UpdateCategoryDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        category={selectedCategory}
        onSuccess={() => {
          setShowUpdateDialog(false)
          setSelectedCategory(null)
          refetchCategories()
        }}
      />
    </div>
  )
}
