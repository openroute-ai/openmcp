'use client'

import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { CreateWorkflowDialog } from './components/create-workflow-dialog'
import { UpdateWorkflowDialog } from './components/update-workflow-dialog'
import { WorkflowTable } from './components/workflow-table'

export default function WorkflowsPage() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [workflows, setWorkflows] = useState<any[]>([])
  const [selectedWorkflow, setSelectedWorkflow] = useState<any | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    published: 0,
    draft: 0,
    archived: 0,
    certified: 0,
  })
  const [pagination, setPagination] = useState<any>(null)
  const [filters, setFilters] = useState({
    search: '',
    status: 'all' as string,
    priceType: 'all' as string,
    complexity: 'all' as string,
    certified: undefined as boolean | undefined,
    authorId: undefined as string | undefined,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  const debouncedSearch = useDebounce(filters.search, 500)

  const {
    data: workflowsData,
    isLoading: isLoadingWorkflows,
    refetch: refetchWorkflows,
  } = trpc.admin.workflows.getWorkflowsPaginated.useQuery({
    page,
    limit,
    search: debouncedSearch || undefined,
    status: filters.status !== 'all' ? (filters.status as 'draft' | 'published' | 'archived' | 'rejected') : undefined,
    priceType: filters.priceType !== 'all' ? (filters.priceType as 'free' | 'paid') : undefined,
    complexity:
      filters.complexity !== 'all' ? (filters.complexity as 'beginner' | 'intermediate' | 'advanced') : undefined,
    certified: filters.certified,
    authorId: filters.authorId,
  })

  const { data: statsData, isLoading: isLoadingStatsData } = trpc.admin.workflows.getWorkflowStats.useQuery()

  useEffect(() => {
    if (workflowsData?.success) {
      setWorkflows(workflowsData.data || [])
      setPagination(workflowsData.pagination || null)
    } else if (workflowsData?.error) {
      toast.error(workflowsData.error)
    }
    setIsLoading(isLoadingWorkflows)
  }, [workflowsData, isLoadingWorkflows])

  useEffect(() => {
    if (statsData?.success) {
      setStats({
        total: statsData.data?.total ?? 0,
        published: statsData.data?.published ?? 0,
        draft: statsData.data?.draft ?? 0,
        archived: statsData.data?.archived ?? 0,
        certified: statsData.data?.certified ?? 0,
      })
    } else if (statsData?.error) {
      toast.error(statsData.error)
    }
    setIsLoadingStats(isLoadingStatsData)
  }, [statsData, isLoadingStatsData])

  const { refetch: refetchStats } = trpc.admin.workflows.getWorkflowStats.useQuery()

  const handleUpdate = useCallback((workflow: any) => {
    setSelectedWorkflow(workflow)
    setShowUpdateDialog(true)
  }, [])

  const handleCreateSuccess = useCallback(async () => {
    setShowCreateDialog(false)
    await Promise.all([refetchWorkflows(), refetchStats()])
    toast.success('创建成功')
  }, [refetchWorkflows, refetchStats])

  const handleFiltersChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setPage(1)
  }, [])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchWorkflows(), refetchStats()])
  }, [refetchWorkflows, refetchStats])

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>工作流管理</h1>
          <p className='text-muted-foreground'>管理系统中的所有工作流，包括工作流信息和状态管理</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={handleRefresh}>
            <RefreshCw className='mr-2 h-4 w-4' />
            刷新
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className='mr-2 h-4 w-4' />
            创建工作流
          </Button>
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-5'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>总数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已发布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.published || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>草稿</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.draft || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已归档</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.archived || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已认证</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.certified || 0}</div>
          </CardContent>
        </Card>
      </div>

      <WorkflowTable
        data={workflows}
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

      <CreateWorkflowDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={handleCreateSuccess}
      />

      <UpdateWorkflowDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        workflow={selectedWorkflow}
        onSuccess={() => {
          setShowUpdateDialog(false)
          setSelectedWorkflow(null)
          refetchWorkflows()
        }}
      />
    </div>
  )
}
