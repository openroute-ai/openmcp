'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { AuthorTable } from './components/author-table'
import { CreateAuthorDialog } from './components/create-author-dialog'
import { UpdateAuthorDialog } from './components/update-author-dialog'

export default function AuthorsPage() {
  // 状态管理
  const [page, setPage] = useState(1)
  const [limit] = useState(10)

  // 本地状态管理
  const [authors, setAuthors] = useState<any[]>([])
  const [selectedAuthor, setSelectedAuthor] = useState<any | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    verified: 0,
    suspended: 0,
  })
  const [pagination, setPagination] = useState<any>(null)
  const [filters, setFilters] = useState({
    search: '',
    status: 'all' as string,
    verified: undefined as boolean | undefined,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  // 防抖处理搜索条件
  const debouncedSearch = useDebounce(filters.search, 500)

  // tRPC queries
  const {
    data: authorsData,
    isLoading: isLoadingAuthors,
    refetch: refetchAuthors,
  } = trpc.admin.authors.getAuthorsPaginated.useQuery({
    page,
    limit,
    search: debouncedSearch || undefined,
    status: filters.status !== 'all' ? (filters.status as 'active' | 'inactive' | 'suspended') : undefined,
    verified: filters.verified,
  })

  const { data: statsData, isLoading: isLoadingStatsData } = trpc.admin.authors.getAuthorStats.useQuery()

  // 更新状态
  useEffect(() => {
    if (authorsData?.success) {
      const data = authorsData.data
      setAuthors(data || [])
      setPagination(authorsData.pagination || null)
    } else if (authorsData?.error) {
      toast.error(authorsData.error)
    }
    setIsLoading(isLoadingAuthors)
  }, [authorsData, isLoadingAuthors])

  useEffect(() => {
    if (statsData?.success) {
      setStats({
        total: statsData.data?.total ?? 0,
        active: statsData.data?.active ?? 0,
        verified: statsData.data?.verified ?? 0,
        suspended: statsData.data?.suspended ?? 0,
      })
    } else if (statsData?.error) {
      toast.error(statsData.error)
    }
    setIsLoadingStats(isLoadingStatsData)
  }, [statsData, isLoadingStatsData])

  // 获取统计数据的refetch函数
  const { refetch: refetchStats } = trpc.admin.authors.getAuthorStats.useQuery()

  // 处理更新作者
  const handleUpdate = useCallback((author: any) => {
    setSelectedAuthor(author)
    setShowUpdateDialog(true)
  }, [])

  const handleCreateSuccess = useCallback(async () => {
    setShowCreateDialog(false)
    // 重新加载数据
    await Promise.all([refetchAuthors(), refetchStats()])
    toast.success('创建成功')
  }, [refetchAuthors, refetchStats])

  // 处理过滤条件变化
  const handleFiltersChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setPage(1) // 重置到第一页
  }, [])

  // 处理页面变化
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchAuthors(), refetchStats()])
  }, [refetchAuthors, refetchStats])

  return (
    <div className='space-y-6'>
      {/* 页面标题和操作按钮 */}
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>作者管理</h1>
          <p className='text-muted-foreground'>管理系统中的所有作者，包括作者信息和状态管理</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={handleRefresh}>
            <RefreshCw className='mr-2 h-4 w-4' />
            刷新
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className='mr-2 h-4 w-4' />
            创建作者
          </Button>
        </div>
      </div>

      {/* 统计信息 */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>总作者数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>活跃作者</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.active || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已验证</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.verified || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已暂停</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.suspended || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* 作者列表 */}
      <AuthorTable
        data={authors}
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

      {/* 创建作者对话框 */}
      <CreateAuthorDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onSuccess={handleCreateSuccess} />

      {/* 更新作者对话框 */}
      <UpdateAuthorDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        author={selectedAuthor}
        onSuccess={() => {
          setShowUpdateDialog(false)
          setSelectedAuthor(null)
          refetchAuthors()
        }}
      />
    </div>
  )
}
