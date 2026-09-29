'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Activity, ArrowRight, Bot, Cable, FlaskConical, Loader2, Plug, Plus, Search, Trash2, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { resultError } from '@/lib/gateway/input'
import { trpc } from '@/lib/trpc/client'
import { AssetDetailView } from './asset-detail'
import { type AssetVisibility, buildMetrics, type MyAsset, type MyAssetType } from './assets-data'
import { AssetStatusBadge, assetAuthLabelKey, BILLING_KEY, SCOPE_KEY, STATUS_KEY, TITLE_KEY } from './assets-ui'
import { ConnectAssetDialog } from './connect-asset-dialog'
import { SkillsConnectDialog } from './skills-connect-dialog'

const TYPE_ICONS: Record<MyAssetType, ReactNode> = {
  mcp: <Bot className='size-5' />,
  a2a: <FlaskConical className='size-5' />,
  skills: <Cable className='size-5' />,
}

interface MyAssetsPageProps {
  type: MyAssetType
}

export function MyAssetsPage({ type }: MyAssetsPageProps) {
  const t = useTranslations('Dashboard.myAssets')
  const tDashboard = useTranslations('Dashboard.dashboard')

  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get('id')
  const utils = trpc.useUtils()

  const mcpQuery = trpc.mcpServers.listMine.useQuery(undefined, { enabled: type === 'mcp' })
  const a2aQuery = trpc.a2aAgents.listMine.useQuery(undefined, { enabled: type === 'a2a' })
  const skillsQuery = trpc.skills.listMine.useQuery(undefined, { enabled: type === 'skills' })
  const listQuery = type === 'mcp' ? mcpQuery : type === 'a2a' ? a2aQuery : skillsQuery
  const assets = useMemo(() => (listQuery.data?.success ? (listQuery.data.data as MyAsset[]) : []), [listQuery.data])

  const mcpToggle = trpc.mcpServers.toggle.useMutation()
  const a2aToggle = trpc.a2aAgents.toggle.useMutation()
  const skillsToggle = trpc.skills.toggle.useMutation()
  const mcpRemove = trpc.mcpServers.remove.useMutation()
  const a2aRemove = trpc.a2aAgents.remove.useMutation()
  const skillsRemove = trpc.skills.remove.useMutation()
  const mcpRetest = trpc.mcpServers.retest.useMutation()
  const a2aRetest = trpc.a2aAgents.retest.useMutation()
  const skillsRescan = trpc.skills.rescan.useMutation()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MyAsset | null>(null)

  const invalidateList = useCallback(() => {
    if (type === 'mcp') void utils.mcpServers.listMine.invalidate()
    if (type === 'a2a') void utils.a2aAgents.listMine.invalidate()
    if (type === 'skills') void utils.skills.listMine.invalidate()
  }, [type, utils])

  const titleKey = TITLE_KEY[type]

  const breadcrumbs = [
    { label: tDashboard('title'), href: '/dashboard' },
    { label: t('title'), href: `/dashboard/assets/${type}` },
    { label: t(titleKey), isCurrentPage: true },
  ]

  const selectedAsset = selectedId ? assets.find((asset) => asset.id === selectedId) : undefined

  const filtered = assets.filter((asset) => {
    if (statusFilter !== 'all' && asset.status !== statusFilter) return false
    if (!search.trim()) return true
    const keyword = search.trim().toLowerCase()
    return (
      asset.name.toLowerCase().includes(keyword) ||
      asset.slug.toLowerCase().includes(keyword) ||
      (asset.endpoint ?? '').toLowerCase().includes(keyword)
    )
  })

  const metrics = assets.map(buildMetrics)
  const totalRequests = metrics.reduce((sum, item) => sum + item.requests, 0)
  const totalErrors = metrics.reduce((sum, item) => sum + item.errors, 0)
  const avgSuccess =
    metrics.length === 0
      ? '100.00'
      : (metrics.reduce((sum, item) => sum + Number(item.success), 0) / metrics.length).toFixed(2)

  const handleCreated = useCallback(() => {
    invalidateList()
  }, [invalidateList])

  const goDetail = useCallback(
    (id: string) => {
      router.push(`${pathname}?id=${encodeURIComponent(id)}`, { scroll: true })
    },
    [router, pathname]
  )

  const goBackToList = useCallback(() => {
    router.push(pathname, { scroll: true })
  }, [router, pathname])

  const handleTest = useCallback(
    async (asset: MyAsset) => {
      setTestingId(asset.id)
      try {
        if (type === 'mcp') {
          const result = await mcpRetest.mutateAsync({ id: asset.id })
          if (!result.success || !result.data?.ok) throw new Error(resultError(result) || t('testFail'))
          toast.success(t('testSuccess'), { description: t('testSuccessTools', { count: result.data.toolCount ?? 0 }) })
        } else if (type === 'a2a') {
          const result = await a2aRetest.mutateAsync({ id: asset.id })
          if (!result.success || !result.data?.ok) throw new Error(resultError(result) || t('testFail'))
          toast.success(t('testSuccess'), { description: t('testSuccessCard', { count: result.data.toolCount ?? 0 }) })
        } else {
          await skillsRescan.mutateAsync({ id: asset.id })
          toast.success('重新扫描完成')
        }
        invalidateList()
      } catch (error) {
        toast.error(t('testFail'), { description: error instanceof Error ? error.message : t('testTimeout') })
      } finally {
        setTestingId(null)
      }
    },
    [a2aRetest, invalidateList, mcpRetest, skillsRescan, t, type]
  )

  const handleToggle = useCallback(
    async (asset: MyAsset) => {
      const enabled = asset.status === 'disabled'
      try {
        if (type === 'mcp') await mcpToggle.mutateAsync({ id: asset.id, enabled })
        else if (type === 'a2a') await a2aToggle.mutateAsync({ id: asset.id, enabled })
        else await skillsToggle.mutateAsync({ id: asset.id, enabled })
        invalidateList()
        toast(enabled ? t('toggleEnable') : t('toggleDisable'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '更新状态失败')
      }
    },
    [a2aToggle, invalidateList, mcpToggle, skillsToggle, t, type]
  )

  const handleDelete = useCallback(async () => {
    if (!pendingDelete) return
    try {
      if (type === 'mcp') await mcpRemove.mutateAsync({ id: pendingDelete.id })
      else if (type === 'a2a') await a2aRemove.mutateAsync({ id: pendingDelete.id })
      else await skillsRemove.mutateAsync({ id: pendingDelete.id })
      if (selectedId === pendingDelete.id) router.push(pathname)
      setPendingDelete(null)
      invalidateList()
      toast.info(t('toggleDisable'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }, [invalidateList, mcpRemove, a2aRemove, skillsRemove, pendingDelete, pathname, router, selectedId, t, type])

  const handleToggleFromDetail = useCallback(
    (id: string, enabled: boolean) => {
      if (type === 'mcp') void mcpToggle.mutateAsync({ id, enabled }).then(invalidateList)
      else if (type === 'a2a') void a2aToggle.mutateAsync({ id, enabled }).then(invalidateList)
      else void skillsToggle.mutateAsync({ id, enabled }).then(invalidateList)
    },
    [a2aToggle, invalidateList, mcpToggle, skillsToggle, type]
  )

  const handleTestResultFromDetail = useCallback(() => {
    invalidateList()
  }, [invalidateList])

  const handleVisibilityFromDetail = useCallback(() => {
    invalidateList()
  }, [invalidateList])

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='mx-auto flex w-full max-w-7xl flex-1 flex-col'>
        <div className='@container/main flex flex-1 flex-col gap-2'>
          <div className='flex flex-col gap-4 py-4 md:gap-6 md:py-6'>
            <div className='flex flex-col gap-4 px-4 md:gap-6 lg:px-6'>
              {selectedAsset ? (
                <AssetDetailView
                  asset={selectedAsset}
                  type={type}
                  onBack={goBackToList}
                  onToggleEnabled={(enabled) => handleToggleFromDetail(selectedAsset.id, enabled)}
                  onTestResult={() => handleTestResultFromDetail()}
                  onVisibilityChange={() => handleVisibilityFromDetail()}
                />
              ) : (
                <>
                  <div className='flex flex-wrap items-end justify-between gap-4'>
                    <div>
                      <h1 className='mb-1 flex items-center gap-2 font-bold text-2xl'>
                        <span className='text-primary'>{TYPE_ICONS[type]}</span>
                        {t(titleKey)}
                      </h1>
                      <p className='text-muted-foreground'>{t('listSubtitle')}</p>
                    </div>
                    <Button size='lg' onClick={() => setDialogOpen(true)}>
                      <Plus className='mr-2 size-4' />
                      {t('connectAsset')}
                    </Button>
                  </div>

                  {/* 调用观测汇总 */}
                  <Card>
                    <CardContent className='p-4'>
                      <div className='mb-3 flex items-center gap-2'>
                        <Activity className='size-4 text-primary' />
                        <h2 className='font-medium'>{t('observabilityTitle')}</h2>
                      </div>
                      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
                        <SummaryStat label={t('obsRequests')} value={totalRequests.toLocaleString()} />
                        <SummaryStat label={t('obsSuccessRate')} value={`${avgSuccess}%`} />
                        <SummaryStat
                          label={t('obsLatency')}
                          value={`${Math.round(metrics.map((m) => Number(m.p50.replace('ms', ''))).reduce((a, b) => a + b, 0) / Math.max(metrics.length, 1))}ms`}
                        />
                        <SummaryStat
                          label={t('obsErrors')}
                          value={totalErrors.toLocaleString()}
                          alert={totalErrors > 0}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* 筛选 */}
                  <div className='flex flex-wrap items-center gap-2'>
                    <div className='relative min-w-[240px] flex-1'>
                      <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className='pl-9'
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className='w-[160px]'>
                        <SelectValue placeholder={t('statusAll')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all'>{t('statusAll')}</SelectItem>
                        {(['online', 'reviewing', 'published', 'rejected', 'disabled', 'abnormal'] as const).map(
                          (status) => (
                            <SelectItem key={status} value={status}>
                              {t(STATUS_KEY[status])}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {statusFilter !== 'all' || search ? (
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label='clear'
                        onClick={() => {
                          setStatusFilter('all')
                          setSearch('')
                        }}
                      >
                        <X className='size-4' />
                      </Button>
                    ) : null}
                  </div>

                  {/* 资产列表 */}
                  {listQuery.isLoading ? (
                    <Card>
                      <CardContent className='flex items-center justify-center gap-2 py-16 text-muted-foreground'>
                        <Loader2 className='size-5 animate-spin' />
                        加载中...
                      </CardContent>
                    </Card>
                  ) : assets.length === 0 ? (
                    <EmptyState
                      title={t('emptyTitle')}
                      desc={t('emptyDesc')}
                      actionLabel={t('emptyAction')}
                      onAction={() => setDialogOpen(true)}
                    />
                  ) : filtered.length === 0 ? (
                    <EmptyState title={t('noMatchedTitle')} desc={t('noMatchedDesc')} />
                  ) : (
                    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
                      {filtered.map((asset) => (
                        <AssetCard
                          key={asset.id}
                          asset={asset}
                          type={type}
                          testing={testingId === asset.id}
                          onDetail={() => goDetail(asset.id)}
                          onTest={() => handleTest(asset)}
                          onToggle={() => handleToggle(asset)}
                          onDelete={() => setPendingDelete(asset)}
                          labels={{
                            detail: t('actionDetail'),
                            test: t('actionTest'),
                            delete: t('actionDelete'),
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {type === 'skills' ? (
        <SkillsConnectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={handleCreated} />
      ) : (
        <ConnectAssetDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type={type}
          existingSlugs={assets.map((asset) => asset.slug)}
          onCreated={handleCreated}
        />
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirmDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-white hover:bg-destructive/90'>
              {t('actionDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SummaryStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className='flex items-center gap-3 rounded-lg border p-3'>
      <div className='min-w-0 flex-1'>
        <p className='text-muted-foreground text-xs'>{label}</p>
        <p className={`mt-0.5 font-bold text-xl ${alert ? 'text-destructive' : ''}`}>{value}</p>
      </div>
    </div>
  )
}

function AssetCard({
  asset,
  type,
  testing,
  onDetail,
  onTest,
  onToggle,
  onDelete,
  labels,
}: {
  asset: MyAsset
  type: MyAssetType
  testing: boolean
  onDetail: () => void
  onTest: () => void
  onToggle: () => void
  onDelete: () => void
  labels: { detail: string; test: string; delete: string }
}) {
  const t = useTranslations('Dashboard.myAssets')
  const statusKey = STATUS_KEY[asset.status]
  const protocol =
    type === 'a2a'
      ? asset.protocol
      : type === 'skills'
        ? 'OpenAI'
        : t(asset.protocol === 'streamable' ? 'protoStreamable' : asset.protocol === 'sse' ? 'protoSse' : 'protoStdio')
  const auth = t(assetAuthLabelKey(asset.auth))
  const priceLabel =
    asset.price.type === 'free'
      ? t('priceFree')
      : `${asset.price.model ? t(BILLING_KEY[asset.price.model]) : t('billingSub')} ¥${asset.price.amount}`
  const visibilityLabel = t(SCOPE_KEY[asset.visibility])

  return (
    <Card className='group flex h-full flex-col transition-colors hover:border-primary/40'>
      <CardContent className='flex flex-1 flex-col gap-4 p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-3'>
            <span className='rounded-lg bg-primary/10 p-2 text-primary'>{TYPE_ICONS[asset.type]}</span>
            <div className='min-w-0'>
              <p className='flex items-center gap-2 font-medium'>
                <span className='truncate'>{asset.name}</span>
                {asset.rejectReason ? <Badge variant='destructive'>{t('rejectReason')}</Badge> : null}
              </p>
              <p className='font-mono text-muted-foreground text-xs'>{asset.slug}</p>
            </div>
          </div>
          <AssetStatusBadge status={asset.status} label={t(statusKey)} />
        </div>

        <div className='min-w-0 space-y-1'>
          <p className='truncate font-mono text-muted-foreground text-xs'>{asset.endpoint ?? '—'}</p>
          <div className='flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs'>
            <span>
              {t('colProtocol')}: <span className='font-medium text-foreground'>{protocol}</span>
            </span>
            <span>
              {t('colVisibility')}: <span className='font-medium text-foreground'>{visibilityLabel}</span>
            </span>
            <span>{asset.tools !== null && asset.tools !== undefined ? `${asset.tools} tools` : '—'}</span>
            <span>
              {t('colPrice')}: <span className='font-medium text-foreground'>{priceLabel}</span>
              <p className='text-muted-foreground text-xs'>
                {t('engagement', {
                  views: asset.views ?? 0,
                  downloads: asset.downloads ?? 0,
                })}
              </p>
            </span>
            <span>
              {t('ovAuth')}: <span className='font-medium text-foreground'>{auth}</span>
            </span>
          </div>
        </div>

        {asset.status === 'rejected' && asset.rejectReason ? (
          <div className='rounded-lg bg-destructive/10 p-3 text-destructive text-xs'>{asset.rejectReason}</div>
        ) : null}

        <div className='mt-auto flex items-center gap-2 border-t pt-3'>
          <Button variant='secondary' size='sm' onClick={onDetail}>
            {labels.detail}
            <ArrowRight className='ml-1.5 size-3.5' />
          </Button>
          <Button variant='ghost' size='sm' onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className='mr-1.5 size-3.5 animate-spin' /> : <Plug className='mr-1.5 size-3.5' />}
            {labels.test}
          </Button>
          <Button variant='ghost' size='sm' onClick={onToggle}>
            {asset.status === 'disabled' ? t('toggleEnable') : t('toggleDisable')}
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='ml-auto text-muted-foreground hover:text-destructive'
            onClick={onDelete}
          >
            <Trash2 className='size-4' />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyState({
  title,
  desc,
  actionLabel,
  onAction,
}: {
  title: string
  desc: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Card>
      <CardContent className='p-6'>
        <div className='flex flex-col items-center gap-4 py-10 text-center'>
          <Cable className='size-10 text-muted-foreground' />
          <div>
            <p className='font-medium'>{title}</p>
            <p className='mt-1 max-w-md text-muted-foreground text-sm'>{desc}</p>
          </div>
          {actionLabel && onAction ? (
            <Button onClick={onAction}>
              <Plus className='mr-2 size-4' />
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
