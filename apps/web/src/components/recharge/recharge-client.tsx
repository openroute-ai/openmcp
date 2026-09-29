'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { AlertCircle, Check, Copy, Landmark, Loader2, QrCode } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { trpc } from '@/lib/trpc/client'

type Order = {
  orderId: string
  amount: string
  credits: string
  currency: string
  status: string
  paymentMethod: string
  type: string
  createdAt: Date
  expiresAt: Date
  paidAt: Date | null
}

/** Order statuses are not localized in the server payload; map them here. */
const useStatusLabel = () => {
  const t = useTranslations('RechargePage')
  return (status: string) => {
    switch (status) {
      case 'pending':
        return t('statusPending')
      case 'pending_transfer':
        return t('statusPendingTransfer')
      case 'paid':
        return t('statusPaid')
      case 'expired':
        return t('statusExpired')
      case 'closed':
        return t('statusClosed')
      case 'failed':
        return t('statusFailed')
      default:
        return status
    }
  }
}

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const t = useTranslations('RechargePage')
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          // Clipboard can be blocked; the value is visible next to the button.
        }
      }}
    >
      {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
      {copied ? t('copied') : t('copy')}
      <span className='sr-only'>{label}</span>
    </Button>
  )
}

export const RechargeClient = () => {
  const t = useTranslations('RechargePage')
  const statusLabel = useStatusLabel()
  const utils = trpc.useUtils()

  const config = trpc.recharge.getConfig.useQuery()
  const history = trpc.recharge.history.useQuery({ limit: 20 })

  const [tab, setTab] = useState('online')
  const [selected, setSelected] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [order, setOrder] = useState<Order | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [remittanceCode, setRemittanceCode] = useState<string | null>(null)
  const [payerName, setPayerName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const createPayment = trpc.recharge.createPayment.useMutation({
    onSuccess: (res) => {
      setError(null)
      if (res.success) {
        setOrder(res.data as Order)
        setQrCode(res.data.qrCode ?? null)
        setRemittanceCode(null)
      }
    },
    onError: (e) => setError(e.message || t('errorGeneric')),
  })
  const createBankTransfer = trpc.recharge.createBankTransfer.useMutation({
    onSuccess: (res) => {
      setError(null)
      if (res.success) {
        setOrder(res.data as Order)
        setRemittanceCode(res.data.remittanceCode)
        setQrCode(null)
      }
    },
    onError: (e) => setError(e.message || t('errorGeneric')),
  })

  // Amount presets come from the server so the client never hardcodes prices.
  const amounts = config.data?.amounts ?? []
  const min = config.data?.min ?? 1
  const max = config.data?.max ?? 50000
  const isSimulation = config.data?.simulation ?? false

  const effectiveAmount = useMemo(() => {
    if (custom.trim()) return Number(custom)
    return selected
  }, [custom, selected])

  const customError = useMemo(() => {
    if (!custom.trim()) return null
    const n = Number(custom)
    if (!Number.isInteger(n)) return t('errorAmountInvalid')
    if (n < min || n > max) return t('errorAmountRange')
    return null
  }, [custom, min, max, t])

  const canSubmit = effectiveAmount != null && !customError

  const pollOrder = useCallback(async (orderId: string) => {
    try {
      const res = await utils.recharge.checkStatus.fetch({ orderId })
      if (res.success) {
        setOrder((prev) => (prev ? { ...prev, ...(res.data as Order) } : prev))
        if (res.data.status === 'paid') {
          void utils.recharge.history.invalidate()
        }
      }
    } catch {
      // Transient poll failure; the next tick retries.
    }
  }, [utils])

  // Poll while an order is unsettled so a real callback shows up without a reload.
  const orderId = order?.orderId
  const orderStatus = order?.status

  useEffect(() => {
    if (!orderId) return
    if (orderStatus === 'paid' || orderStatus === 'closed' || orderStatus === 'failed') return
    if (orderStatus === 'pending_transfer') {
      // Bank transfers are reconciled by an admin, not by a callback. Poll far
      // less aggressively since nothing will change second to second.
      pollRef.current = setTimeout(() => void pollOrder(orderId), 15_000)
      return
    }
    pollRef.current = setTimeout(() => void pollOrder(orderId), 3_000)
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [orderId, orderStatus, pollOrder])

  const simulate = async (outcome: 'success' | 'fail') => {
    if (!order) return
    const res = await fetch(`/api/pay/simulate/${order.orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    })
    const body = (await res.json()) as {
      success?: boolean
      error?: string
      code?: string
      alreadySettled?: boolean
    }
    if (!res.ok || !body.success) {
      setError(body.error || t('errorGeneric'))
      return
    }
    await pollOrder(order.orderId)
  }

  const busy = createPayment.isPending || createBankTransfer.isPending
  const bank = config.data?.bankTransfer
  const bankConfigured = Boolean(bank?.accountNumber)

  return (
    <div className='mx-auto w-full max-w-page space-y-6 px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold tracking-tight'>{t('title')}</h1>
        <p className='text-muted-foreground text-sm'>{t('subtitle')}</p>
      </header>

      {isSimulation && (
        <Alert>
          <AlertCircle className='h-4 w-4' />
          <AlertTitle>{t('simulationBanner')}</AlertTitle>
          <AlertDescription>{t('simulateHint')}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant='destructive'>
          <AlertCircle className='h-4 w-4' />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value='online'>
            <QrCode className='h-4 w-4' />
            {t('tabOnline')}
          </TabsTrigger>
          <TabsTrigger value='bank'>
            <Landmark className='h-4 w-4' />
            {t('tabBank')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value='online' className='mt-4 space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>{t('chooseAmount')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex flex-wrap gap-2'>
                {amounts.map((a) => (
                  <Button
                    key={a}
                    type='button'
                    variant={selected === a && !custom ? 'default' : 'outline'}
                    onClick={() => {
                      setSelected(a)
                      setCustom('')
                    }}
                    disabled={busy}
                  >
                    ¥{a}
                  </Button>
                ))}
              </div>

              <div className='space-y-2'>
                <Label htmlFor='custom-amount'>{t('customAmount')}</Label>
                <Input
                  id='custom-amount'
                  type='number'
                  inputMode='numeric'
                  min={min}
                  max={max}
                  step={1}
                  value={custom}
                  onChange={(e) => {
                    setCustom(e.target.value)
                    setSelected(null)
                  }}
                  placeholder={`${min} - ${max}`}
                  disabled={busy}
                />
                {customError ? (
                  <p className='text-destructive text-sm'>{customError}</p>
                ) : (
                  <p className='text-muted-foreground text-sm'>{t('customAmountHint')}</p>
                )}
              </div>

              <Button
                type='button'
                onClick={() => {
                  if (effectiveAmount != null) {
                    createPayment.mutate({ amount: effectiveAmount })
                  }
                }}
                disabled={!canSubmit || busy}
              >
                {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                {busy ? t('creating') : t('createOrder')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='bank' className='mt-4 space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>{t('bankTitle')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <p className='text-muted-foreground text-sm'>{t('bankIntro')}</p>

              {!bankConfigured ? (
                <Alert>
                  <AlertCircle className='h-4 w-4' />
                  <AlertDescription>{t('bankNotConfigured')}</AlertDescription>
                </Alert>
              ) : (
                <>
                  <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                    <div>
                      <dt className='text-muted-foreground'>{t('bankAccountName')}</dt>
                      <dd className='font-medium'>{bank?.accountName || '—'}</dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground'>{t('bankAccountNumber')}</dt>
                      <dd className='flex items-center gap-1 font-mono font-medium'>
                        {bank?.accountNumber}
                        {bank?.accountNumber && <CopyButton value={bank.accountNumber} label={t('bankAccountNumber')} />}
                      </dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground'>{t('bankName')}</dt>
                      <dd className='font-medium'>{bank?.bankName || '—'}</dd>
                    </div>
                    <div>
                      <dt className='text-muted-foreground'>{t('bankBranch')}</dt>
                      <dd className='font-medium'>{bank?.branchName || '—'}</dd>
                    </div>
                  </dl>

                  <div className='flex flex-wrap gap-2'>
                    {amounts.map((a) => (
                      <Button
                        key={a}
                        type='button'
                        variant={selected === a && !custom ? 'default' : 'outline'}
                        onClick={() => {
                          setSelected(a)
                          setCustom('')
                        }}
                        disabled={busy}
                      >
                        ¥{a}
                      </Button>
                    ))}
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='payer-name'>{t('payerNameLabel')}</Label>
                    <Input
                      id='payer-name'
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                      maxLength={64}
                      disabled={busy}
                    />
                    <p className='text-muted-foreground text-sm'>{t('payerNameHint')}</p>
                  </div>

                  <Button
                    type='button'
                    onClick={() => {
                      if (effectiveAmount != null) {
                        createBankTransfer.mutate({
                          amount: effectiveAmount,
                          payerName: payerName.trim() || undefined,
                        })
                      }
                    }}
                    disabled={!canSubmit || busy}
                  >
                    {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : null}
                    {busy ? t('creating') : t('createBankOrder')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {order && (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between gap-2 space-y-0'>
            <CardTitle className='text-base'>
              {t('historyAmount')}: ¥{order.amount}
            </CardTitle>
            <Badge
              variant={
                order.status === 'paid'
                  ? 'default'
                  : order.status === 'closed' || order.status === 'failed' || order.status === 'expired'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {statusLabel(order.status)}
            </Badge>
          </CardHeader>
          <CardContent className='space-y-4'>
            {order.status === 'paid' && (
              <div className='flex items-center gap-2 text-sm font-medium text-green-600'>
                <Check className='h-4 w-4' />
                {t('paySucceeded')}
              </div>
            )}
            {order.status === 'pending' && (
              <p className='text-muted-foreground text-sm'>{t('payPending')}</p>
            )}
            {order.status === 'pending_transfer' && (
              <div className='space-y-3'>
                <p className='text-muted-foreground text-sm'>{t('bankAwaitingHint')}</p>
                {remittanceCode && (
                  <div className='bg-muted flex items-center justify-between gap-2 rounded-md p-3'>
                    <div className='min-w-0'>
                      <p className='text-muted-foreground text-xs'>{t('remittanceLabel')}</p>
                      <p className='truncate font-mono text-lg font-semibold'>{remittanceCode}</p>
                    </div>
                    <CopyButton value={remittanceCode} label={t('remittanceLabel')} />
                  </div>
                )}
                <p className='text-muted-foreground text-xs'>{t('remittanceHint')}</p>
              </div>
            )}

            {order.status === 'paid' && (
              <p className='text-muted-foreground text-sm'>
                {t('balanceNow')}: ¥{order.credits}
              </p>
            )}

            {qrCode && order.status === 'pending' && (
              <div className='space-y-2'>
                <p className='text-sm font-medium'>{t('scanToPay')}</p>
                <p className='text-muted-foreground text-xs'>{t('scanHint')}</p>
                <pre className='bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs'>
                  {qrCode}
                </pre>
              </div>
            )}

            {isSimulation && order.status === 'pending' && (
              <div className='space-y-2 rounded-md border border-dashed p-3'>
                <div className='flex flex-wrap gap-2'>
                  <Button type='button' size='sm' onClick={() => simulate('success')}>
                    {t('simulatePay')}
                  </Button>
                  <Button type='button' size='sm' variant='outline' onClick={() => simulate('fail')}>
                    {t('simulateDecline')}
                  </Button>
                </div>
                <p className='text-muted-foreground text-xs'>{t('simulateHint')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className='flex flex-row items-center justify-between gap-2 space-y-0'>
          <CardTitle className='text-base'>{t('viewHistory')}</CardTitle>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => void utils.recharge.history.invalidate()}
          >
            {t('refresh')}
          </Button>
        </CardHeader>
        <CardContent>
          {!history.data?.success ? (
            <p className='text-muted-foreground text-sm'>{t('historyEmpty')}</p>
          ) : history.data.data.length === 0 ? (
            <p className='text-muted-foreground text-sm'>{t('historyEmpty')}</p>
          ) : (
            <div className='divide-y'>
              {history.data.data.map((h) => (
                <div key={h.orderId} className='flex items-center justify-between gap-2 py-2 text-sm'>
                  <span className='text-muted-foreground'>
                    {new Date(h.createdAt).toLocaleString()}
                  </span>
                  <span className='font-medium'>¥{h.amount}</span>
                  <Badge
                    variant={h.status === 'paid' ? 'default' : 'secondary'}
                  >
                    {statusLabel(h.status)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
