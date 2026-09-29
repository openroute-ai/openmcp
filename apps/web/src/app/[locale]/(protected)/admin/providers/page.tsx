'use client'

import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { ApplicationsTable } from './components/applications-table'
import { ReviewDialog } from './components/review-dialog'

export default function ProviderApplicationsPage() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [applications, setApplications] = useState<any[]>([])
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null)
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    verified: 0,
    rejected: 0,
    channelReady: 0,
  })
  const [pagination, setPagination] = useState<any>(null)
  const [filters, setFilters] = useState({
    search: '',
    verificationStatus: 'all' as string,
    payChannelStatus: 'all' as string,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [showReviewDialog, setShowReviewDialog] = useState(false)

  const debouncedSearch = useDebounce(filters.search, 500)

  const {
    data: applicationsData,
    isLoading: isLoadingApplications,
    refetch: refetchApplications,
  } = trpc.admin.providers.getApplicationsPaginated.useQuery({
    page,
    limit,
    search: debouncedSearch || undefined,
    verificationStatus:
      filters.verificationStatus !== 'all'
        ? (filters.verificationStatus as 'unverified' | 'pending' | 'verified' | 'rejected')
        : undefined,
    payChannelStatus:
      filters.payChannelStatus !== 'all'
        ? (filters.payChannelStatus as 'unconnected' | 'connecting' | 'ready' | 'error')
        : undefined,
  })

  const { data: statsData, isLoading: isLoadingStatsData } = trpc.admin.providers.getApplicationsStats.useQuery()

  useEffect(() => {
    if (applicationsData?.success) {
      setApplications(applicationsData.data || [])
      setPagination(applicationsData.pagination || null)
    } else if (applicationsData?.error) {
      toast.error(applicationsData.error)
    }
    setIsLoading(isLoadingApplications)
  }, [applicationsData, isLoadingApplications])

  useEffect(() => {
    if (statsData?.success) {
      setStats({
        total: statsData.data?.total ?? 0,
        pending: statsData.data?.pending ?? 0,
        verified: statsData.data?.verified ?? 0,
        rejected: statsData.data?.rejected ?? 0,
        channelReady: statsData.data?.channelReady ?? 0,
      })
    } else if (statsData?.error) {
      toast.error(statsData.error)
    }
    setIsLoadingStats(isLoadingStatsData)
  }, [statsData, isLoadingStatsData])

  const { refetch: refetchStats } = trpc.admin.providers.getApplicationsStats.useQuery()

  const handleReview = useCallback((application: any) => {
    setSelectedApplication(application)
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
    await Promise.all([refetchApplications(), refetchStats()])
  }, [refetchApplications, refetchStats])

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>入驻申请审核</h1>
          <p className='text-muted-foreground'>审核创作者入驻申请，通过后授予入驻标识，全部资料仅平台可见</p>
        </div>
        <Button variant='outline' onClick={handleRefresh}>
          <RefreshCw className='mr-2 h-4 w-4' />
          刷新
        </Button>
      </div>

      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-5'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>总申请</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.total || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>待审核</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.pending || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已通过</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.verified || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>已驳回</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.rejected || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='font-medium text-sm'>收款可用</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='font-bold text-2xl'>{isLoadingStats ? '...' : stats?.channelReady || 0}</div>
          </CardContent>
        </Card>
      </div>

      <ApplicationsTable
        data={applications}
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

      <ReviewDialog
        open={showReviewDialog}
        onOpenChange={setShowReviewDialog}
        application={selectedApplication}
        onSuccess={() => {
          setShowReviewDialog(false)
          setSelectedApplication(null)
          Promise.all([refetchApplications(), refetchStats()])
        }}
      />
    </div>
  )
}
