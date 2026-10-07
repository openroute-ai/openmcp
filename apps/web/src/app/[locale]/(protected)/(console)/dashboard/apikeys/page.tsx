'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import PaginationBox from '@/components/web/pagination-box'
import { Label } from '@workspace/ui/components/label'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { Copy, KeyIcon, PlusIcon, RefreshCwIcon, TriangleAlertIcon, WalletIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils/cn'

interface KeyBudget {
  maxBudget: number
  keySpend: number
  blocked: boolean
  available: string
  syncedAt: string
}

interface ApiKeyRow {
  id: string
  name: string
  provider?: string | null
  keyAlias?: string | null
  start?: string | null
  enabled: boolean
  remaining?: number | null
  expiresAt?: Date | null
  createdAt?: Date | null
  budget?: KeyBudget | null
}

interface BudgetStatus {
  available: string
  currency: string
  blocked: boolean
  gatewayKeyCount: number
  gatewayConfigured: boolean
  keys: {
    id: string
    name: string
    provider: string
    keyAlias: string | null
    budget: KeyBudget | null
  }[]
}

const DATE_LOCALES = { zh: 'zh-CN', en: 'en-US' } as const

export default function ApiKeysPage() {
  const t = useTranslations('Dashboard.apiKeys')
  const locale = useLocale()
  const dateLocale = DATE_LOCALES[locale === 'zh' ? 'zh' : 'en']

  const [createOpen, setCreateOpen] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20

  const { data, isLoading, error, refetch } = trpc.apiKeys.listApiKeys.useQuery({
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  })
  const budgetQuery = trpc.apiKeys.getGatewayBudgetStatus.useQuery()
  const syncBudget = trpc.apiKeys.syncGatewayBudget.useMutation({
    onSuccess: (result) => {
      if (result?.success) {
        const skipped = 'data' in result ? result.data.skipped : false
        toast.success(skipped ? t('budget.syncSkipped') : t('budget.syncSuccess'))
        void refetch()
        void budgetQuery.refetch()
      } else {
        toast.error(result?.error ?? t('budget.syncFail'))
      }
    },
    onError: () => toast.error(t('budget.syncFail')),
  })
  const createApiKey = trpc.apiKeys.createApiKey.useMutation({
    onSuccess: (result) => {
      if (result?.success && 'data' in result) {
        const keyData = result.data as { apiKey: string }
        setCreatedKey(keyData.apiKey)
        setCreateOpen(false)
        void refetch()
      } else {
        toast.error(t('createDialog.fail'))
      }
    },
    onError: () => toast.error(t('createDialog.fail')),
  })
  const deleteApiKey = trpc.apiKeys.deleteApiKey.useMutation({
    onSuccess: (result) => {
      if (result?.success) {
        toast.success(t('deleteDialog.confirm'))
        setDeleteId(null)
        void refetch()
      } else {
        toast.error(t('deleteDialog.fail'))
      }
    },
    onError: () => toast.error(t('deleteDialog.fail')),
  })

  const keys = (data?.data as ApiKeyRow[] | undefined) ?? []
  const totalKeys = data?.total ?? 0
  const budget = (budgetQuery.data?.data as BudgetStatus | undefined) ?? null
  const availableNumber = Number(budget?.available ?? '0')
  const insufficient = budget !== null && availableNumber <= 0
  const isExpired = (key: ApiKeyRow) => !!key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()

  const statusBadge = (key: ApiKeyRow) => {
    if (isExpired(key)) return <Badge variant='outline'>{t('expired')}</Badge>
    return key.enabled ? <Badge>{t('active')}</Badge> : <Badge variant='secondary'>{t('disabled')}</Badge>
  }

  const breadcrumbs = [{ label: t('title'), isCurrentPage: true }]

  return (
    <>
      <DashboardHeader breadcrumbs={breadcrumbs} />

      <div className='flex-1 px-5 py-8 sm:px-6 lg:px-10'>
        <div className='mx-auto w-full max-w-7xl space-y-7'>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <h1 className='font-bold text-section tracking-tight'>{t('title')}</h1>
              <p className='mt-2 text-muted-foreground'>{t('description')}</p>
              <p className='mt-1 text-muted-foreground text-sm'>{t('gatewayHint')}</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className='mr-1 size-4' />
              {t('create')}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <WalletIcon className='size-4 text-muted-foreground' />
                {t('budget.title')}
              </CardTitle>
              <CardDescription>{t('budget.availableHint')}</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <div className='text-muted-foreground text-sm'>{t('budget.available')}</div>
                  <div className='font-bold text-2xl tabular-nums'>
                    {budget ? `${budget.currency} ${Number(budget.available).toFixed(2)}` : '--'}
                  </div>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={syncBudget.isPending || !budget?.gatewayConfigured}
                  onClick={() => syncBudget.mutate()}
                >
                  <RefreshCwIcon className={cn('mr-1 size-4', syncBudget.isPending && 'animate-spin')} />
                  {syncBudget.isPending ? t('budget.syncing') : t('budget.sync')}
                </Button>
              </div>

              {!budget?.gatewayConfigured && (
                <p className='text-muted-foreground text-sm'>{t('budget.notConfigured')}</p>
              )}

              {insufficient && (
                <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
                  <p className='flex items-center gap-2 text-destructive text-sm'>
                    <TriangleAlertIcon className='size-4 shrink-0' />
                    {t('budget.insufficient')}
                  </p>
                  <Button asChild size='sm'>
                    <LocaleLink href='/dashboard/recharge'>{t('budget.recharge')}</LocaleLink>
                  </Button>
                </div>
              )}

              {budget && budget.gatewayKeyCount === 0 && (
                <p className='text-muted-foreground text-sm'>{t('budget.noGatewayKey')}</p>
              )}

              {budget && budget.gatewayKeyCount > 0 && (
                <ul className='divide-y rounded-lg border'>
                  {budget.keys
                    .filter((key) => key.provider === 'litellm')
                    .map((key) => (
                      <li key={key.id} className='flex flex-wrap items-center justify-between gap-2 p-3'>
                        <span className='font-medium text-sm'>{key.name}</span>
                        <span className='text-muted-foreground text-xs'>
                          {t('budget.perKeyBudget')}:{' '}
                          {key.budget
                            ? `${Number(key.budget.maxBudget).toFixed(2)} · ${t('budget.lastSynced')} ${new Date(
                                key.budget.syncedAt
                              ).toLocaleString(dateLocale)}`
                            : t('budget.neverSynced')}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <KeyIcon className='size-4 text-muted-foreground' />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* 搜索在服务端做：key 数量增长后，浏览器端 filter 只能筛到当前页 */}
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder={t('searchPlaceholder')}
                className='mb-4 max-w-64'
              />
              {isLoading ? (
                <div className='space-y-2'>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className='h-12 w-full' />
                  ))}
                </div>
              ) : error ? (
                <div className='flex flex-col items-center gap-2 py-8 text-center'>
                  <p className='text-destructive text-sm'>{t('loadFailed')}</p>
                  <Button variant='outline' size='sm' onClick={() => refetch()}>
                    {t('retry')}
                  </Button>
                </div>
              ) : keys.length === 0 ? (
                <div className='flex flex-col items-center gap-2 py-12 text-center'>
                  <KeyIcon className='size-10 text-muted-foreground/50' />
                  <p className='font-medium'>{t('empty.title')}</p>
                  <p className='text-muted-foreground text-sm'>{t('empty.description')}</p>
                  <Button className='mt-2' onClick={() => setCreateOpen(true)}>
                    {t('createFirst')}
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('prefix')}</TableHead>
                      <TableHead>{t('created')}</TableHead>
                      <TableHead>{t('expiresAt')}</TableHead>
                      <TableHead>{t('remaining')}</TableHead>
                      <TableHead>{t('status')}</TableHead>
                      <TableHead className='w-20' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell>
                          <div className='flex flex-col'>
                            <span className='flex items-center gap-2 font-medium'>
                              {key.name}
                              {key.provider === 'local' && <Badge variant='outline'>{t('localProvider')}</Badge>}
                            </span>
                            {key.start && <span className='text-muted-foreground text-xs'>{key.start}••••</span>}
                          </div>
                        </TableCell>
                        <TableCell className='text-muted-foreground text-sm'>
                          {key.createdAt ? new Date(key.createdAt).toLocaleDateString(dateLocale) : '--'}
                        </TableCell>
                        <TableCell className='text-muted-foreground text-sm'>
                          {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString(dateLocale) : '--'}
                        </TableCell>
                        <TableCell className='text-sm'>{key.remaining ?? '--'}</TableCell>
                        <TableCell>{statusBadge(key)}</TableCell>
                        <TableCell>
                          <Button variant='ghost' size='sm' className='text-destructive' onClick={() => setDeleteId(key.id)}>
                            {t('delete')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {keys.length > 0 ? (
        <div className='mt-4'>
          <PaginationBox page={page} count={totalKeys} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      ) : null}

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(input) => createApiKey.mutate(input)}
      />

      <Dialog
        open={!!createdKey}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createDialog.successTitle')}</DialogTitle>
            <DialogDescription>{t('createDialog.successDescription')}</DialogDescription>
          </DialogHeader>
          <div className='flex items-center gap-2 rounded-lg border bg-muted/50 p-3'>
            <code className='flex-1 break-all font-mono text-sm'>{createdKey}</code>
            <Button
              variant='outline'
              size='icon'
              onClick={() => {
                if (createdKey) {
                  void navigator.clipboard.writeText(createdKey)
                  toast.success(t('apiKeyCopied'))
                }
              }}
            >
              <Copy className='size-4' />
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>{t('createDialog.apiKeyWarning')}</p>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>{t('createDialog.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('deleteDialog.description', {
                name: keys.find((key) => key.id === deleteId)?.name ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleteId(null)}>
              {t('deleteDialog.cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={deleteApiKey.isPending}
              onClick={() => {
                if (deleteId) deleteApiKey.mutate({ id: deleteId })
              }}
            >
              {t('deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface CreateKeyInput {
  name: string
  prefix?: string
  expiresInDays?: number
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CreateKeyInput) => void
}) {
  const t = useTranslations('Dashboard.apiKeys')
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('')
  const nameId = useId()
  const prefixId = useId()
  const expiresId = useId()

  useEffect(() => {
    if (open) {
      setName('')
      setPrefix('')
      setExpiresInDays('')
    }
  }, [open])

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error(t('nameRequired'))
      return
    }
    onSubmit({
      name: name.trim(),
      prefix: prefix.trim() || undefined,
      expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('createDialog.description')}
            <span className='mt-1 block text-xs'>{t('createDialog.gatewayHint')}</span>
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-2'>
            <Label htmlFor={nameId}>{t('createDialog.name')}</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('createDialog.namePlaceholder')}
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor={prefixId}>{t('createDialog.prefix')}</Label>
            <Input
              id={prefixId}
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder={t('createDialog.prefixPlaceholder')}
            />
            <p className='text-muted-foreground text-xs'>{t('createDialog.prefixHint')}</p>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor={expiresId}>{t('createDialog.expiresIn')}</Label>
            <Input
              id={expiresId}
              type='number'
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>{t('createDialog.expiresInHint')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('createDialog.cancel')}
          </Button>
          <Button onClick={handleSubmit}>{t('createDialog.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
