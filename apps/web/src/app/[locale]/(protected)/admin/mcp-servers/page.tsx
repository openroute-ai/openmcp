'use client'

import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { McpReviewDialog } from './components/mcp-review-dialog'
import { McpTable } from './components/mcp-table'

export default function McpServersPage() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [servers, setServers] = useState<any[]>([])
  const [selectedServer, setSelectedServer] = useState<any | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    submitted: 0,
    published: 0,
    draft: 0,
    archived: 0,
    rejected: 0,
    certified: 0,
  })
  const [pagination, setPagination] = useState<any>(null)
  const [filters, setFilters] = useState({
    search: '',
    status: 'all' as string,
    transport: 'all' as string,
    priceType: 'all' as string,
    certified: undefined as boolean | undefined,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)

  const debouncedSearch = useDebounce(filters.search, 500)

  const {
    data: serversData,
    isLoading: isLoadingServers,
    refetch: refetchServers,
  } = trpc.admin.mcpServers.getServersPaginated.useQuery({
    page,
    limit,
    search: debouncedSearch || undefined,
    status:
      filters.status !== 'all'
        ? (filters.status as 'draft' | 'submitted' | 'published' | 'archived' | 'rejected')
        : undefined,
    transport: filters.transport !== 'all' ? (filters.transport as 'http' | 'stdio') : undefined,
    priceType: filters.priceType !== 'all' ? (filters.priceType as 'free' | 'paid') : undefined,
    certified: filters.certified,
  })

  const { data: statsData, isLoading: isLoadingStatsData } = trpc.admin.mcpServers.getServerStats.useQuery()

  useEffect(() => {
    if (serversData?.success) {
      setServers(serversData.data || [])
      setPagination(serversData.pagination || null)
    } else if (serversData?.error) {
      toast.error(serversData.error)
    }
    setIsLoading(isLoadingServers)
  }, [serversData, isLoadingServers])

  useEffect(() => {
    if (statsData?.success) {
      setStats({
        total: statsData.data?.total ?? 0,
        submitted: statsData.data?.submitted ?? 0,
        published: statsData.data?.published ?? 0,
        draft: statsData.data?.draft ?? 0,
        archived: statsData.data?.archived ?? 0,
        rejected: statsData.data?.rejected ?? 0,
        certified: statsData.data?.certified ?? 0,
      })
    } else if (statsData?.error) {
      toast.error(statsData.error)
    }
    setIsLoadingStats(isLoadingStatsData)
  }, [statsData, isLoadingStatsData])

  const { refetch: refetchStats } = trpc.admin.mcpServers.getServerStats.useQuery()

  const handleReview = useCallback((server: any) => {
    setSelectedServer(server)
    setShowReviewDialog(true)
  }, [])

  const handleFiltersChange = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setPage(1)
  }, [])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handleRefresh = useCallback(async () => {
    await Promise.all([refetchServers(), refetchStats()])
  }, [refetchServers, refetchStats])

  const statsCards = [
    { label: '总数量', value: stats.total },
    { label: '待审核', value: stats.submitted },
    { label: '已上架', value: stats.published },
    { label: '草稿', value: stats.draft },
    { label: '已归档', value: stats.archived },
    { label: '已驳回', value: stats.rejected },
    { label: '已认证', value: stats.certified },
  ]

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>MCP Server 管理</h1>
          <p className='text-muted-foreground'>管理 MCP Server 货架内容，完成从提交、审核到上架的全流程</p>
        </div>
        <Button variant='outline' onClick={handleRefresh}>
          <RefreshCw className='mr-2 h-4 w-4' />
          刷新
        </Button>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-7'>
        {statsCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='font-medium text-sm'>{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='font-bold text-2xl'>{isLoadingStats ? '...' : card.value || 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <McpTable
        data={servers}
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
        onReview={handleReview}
      />

      <McpReviewDialog
        open={showReviewDialog}
        onOpenChange={setShowReviewDialog}
        server={selectedServer}
        onSuccess={() => {
          setShowReviewDialog(false)
          setSelectedServer(null)
          Promise.all([refetchServers(), refetchStats()])
        }}
      />
    </div>
  )
}
