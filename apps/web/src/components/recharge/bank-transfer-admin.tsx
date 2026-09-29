'use client'

import { useState } from 'react'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { trpc } from '@/lib/trpc/client'

const STATUS_VARIANT = {
  pending: 'secondary',
  confirmed: 'default',
  rejected: 'destructive',
} as const

/**
 * 对公转账核销台.
 *
 * Every action here moves real money, so the UI is deliberately thin: it calls
 * `adminProcedure` mutations and shows the server's answer. The server owns the
 * "already actioned" check, so a double click or a second admin cannot
 * double-credit — the screen reflects that rather than preventing it locally.
 */
export const BankTransferAdmin = () => {
  const t = useTranslations('AdminBankTransfer')
  const utils = trpc.useUtils()

  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('pending')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<{ orderId: string; reason: string } | null>(null)

  const list = trpc.admin.recharge.listVouchers.useQuery({
    page,
    limit: 20,
    status,
    search: search || undefined,
  })

  const confirm = trpc.admin.recharge.confirmVoucher.useMutation({
    onSuccess: (res) => {
      setError(res.success ? null : (res.error ?? t('errorGeneric')))
      void utils.admin.recharge.listVouchers.invalidate()
    },
    onError: (e) => setError(e.message || t('errorGeneric')),
  })

  const reject = trpc.admin.recharge.rejectVoucher.useMutation({
    onSuccess: (res) => {
      setError(res.success ? null : (res.error ?? t('errorGeneric')))
      setRejecting(null)
      void utils.admin.recharge.listVouchers.invalidate()
    },
    onError: (e) => setError(e.message || t('errorGeneric')),
  })

  const items = list.data?.data.items ?? []
  const total = list.data?.data.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className='mx-auto w-full max-w-page space-y-6 px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('title')}</h1>
        <p className='text-muted-foreground text-sm'>{t('subtitle')}</p>
      </header>

      {error && (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap items-end gap-2'>
            <div className='space-y-1'>
              <label className='text-muted-foreground text-xs'>{t('filterStatus')}</label>
              <select
                className='border-input h-9 rounded-md border px-2 text-sm'
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as typeof status)
                  setPage(1)
                }}
              >
                <option value='pending'>{t('statusPending')}</option>
                <option value='confirmed'>{t('statusConfirmed')}</option>
                <option value='rejected'>{t('statusRejected')}</option>
                <option value='all'>{t('statusAll')}</option>
              </select>
            </div>
            <div className='space-y-1'>
              <label className='text-muted-foreground text-xs'>{t('filterSearch')}</label>
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder={t('filterSearchPlaceholder')}
                className='h-9 w-64'
              />
            </div>
          </div>

          {list.isLoading ? (
            <div className='flex justify-center py-8'>
              <Loader2 className='text-primary h-6 w-6 animate-spin' />
            </div>
          ) : items.length === 0 ? (
            <p className='text-muted-foreground py-8 text-center text-sm'>{t('empty')}</p>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCode')}</TableHead>
                    <TableHead>{t('colAmount')}</TableHead>
                    <TableHead>{t('colPayer')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className='text-right'>{t('colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className='font-mono text-xs'>{item.remittanceCode}</TableCell>
                      <TableCell className='font-medium'>¥{item.amount}</TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {item.payerName || '—'}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-sm'>
                        {new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[item.status as keyof typeof STATUS_VARIANT] ?? 'secondary'}>
                          {t(
                            item.status === 'confirmed'
                              ? 'statusConfirmed'
                              : item.status === 'rejected'
                                ? 'statusRejected'
                                : 'statusPending'
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right'>
                        {item.status === 'pending' ? (
                          <div className='flex justify-end gap-2'>
                            <Button
                              size='sm'
                              disabled={confirm.isPending}
                              onClick={() => confirm.mutate({ orderId: item.orderId })}
                            >
                              {confirm.isPending ? (
                                <Loader2 className='h-4 w-4 animate-spin' />
                              ) : (
                                <Check className='h-4 w-4' />
                              )}
                              {t('confirm')}
                            </Button>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() => setRejecting({ orderId: item.orderId, reason: '' })}
                            >
                              <X className='h-4 w-4' />
                              {t('reject')}
                            </Button>
                          </div>
                        ) : item.status === 'rejected' && item.rejectReason ? (
                          <span className='text-muted-foreground text-xs'>{item.rejectReason}</span>
                        ) : (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {rejecting && (
            <div className='space-y-2 rounded-md border p-3'>
              <label className='text-sm font-medium'>{t('rejectReason')}</label>
              <Input
                value={rejecting.reason}
                onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })}
                maxLength={200}
                placeholder={t('rejectReasonPlaceholder')}
              />
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='destructive'
                  disabled={reject.isPending || rejecting.reason.trim().length === 0}
                  onClick={() => reject.mutate({ orderId: rejecting.orderId, reason: rejecting.reason.trim() })}
                >
                  {reject.isPending && <Loader2 className='h-4 w-4 animate-spin' />}
                  {t('confirmReject')}
                </Button>
                <Button size='sm' variant='ghost' onClick={() => setRejecting(null)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          )}

          {totalPages > 1 && (
            <div className='flex items-center justify-between gap-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('prev')}
              </Button>
              <span className='text-muted-foreground text-sm'>
                {t('pageInfo', { page, totalPages })}
              </span>
              <Button
                size='sm'
                variant='outline'
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
