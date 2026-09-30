'use client'

import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Copy, Download, Loader2, ShieldAlert, Wallet } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { SkillInstallPanel } from '@/components/agent-install/skill-install-panel'
import { LoginWrapper } from '@/components/auth/login-wrapper'
import { authClient } from '@/lib/auth-client'
import { resultError } from '@/lib/gateway/input'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { LocaleLink, useLocalePathname } from '@/i18n/navigation'
import { describeBillingModel, formatSkillPriceDisplay, type SkillBillingModel } from './skill-billing'

type DeliveryPayload = {
  kind: 'github' | 'files'
  title: string
  version: string | null
  platforms: string[]
  installTips: string[]
  riskWarning: string | null
  downloads: number
  githubUrl?: string
  installNotes?: string
  files?: { path: string; content: string }[]
  downloadUrl?: string
  metaPackage?: { files: { path: string; content: string }[]; downloadUrl: string }
}

interface SkillPurchaseProps {
  skillId: string
  skillSlug: string
  skillTitle: string
  priceType: 'free' | 'paid'
  priceAmount: string | null
  currency: string
  billingModel: SkillBillingModel
  securityGrade: string | null
  origin?: string
}

export function SkillPurchase({
  skillId,
  skillSlug,
  skillTitle,
  priceType,
  priceAmount,
  currency,
  billingModel,
  securityGrade,
  origin,
}: SkillPurchaseProps) {
  const t = useTranslations('SkillPage.purchase')
  const locale = useLocale() as 'zh' | 'en'
  const pathname = useLocalePathname()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const utils = trpc.useUtils()

  const [delivery, setDelivery] = useState<DeliveryPayload | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needRecharge, setNeedRecharge] = useState<{
    requiredAmount?: string
    rechargeUrl?: string
  } | null>(null)

  const entitledQuery = trpc.skills.hasEntitlement.useQuery(
    { id: skillId },
    { enabled: Boolean(session?.user) && priceType === 'paid', retry: false }
  )
  const entitled = entitledQuery.data?.success ? entitledQuery.data.data.entitled : false

  const acquireMutation = trpc.skills.acquire.useMutation()
  const purchaseMutation = trpc.skills.createPurchase.useMutation()

  const priceLabel = formatSkillPriceDisplay(priceType, priceAmount, currency, locale)
  const billingLabel = describeBillingModel(billingModel, priceType, locale)

  const ctaLabel = useMemo(() => {
    if (priceType === 'free') return t('freeAcquire')
    if (entitled) return t('acquireOwned')
    return t('buyNow')
  }, [priceType, entitled, t])

  const runAcquire = useCallback(async () => {
    const result = await acquireMutation.mutateAsync({ id: skillId })
    if (!result.success) {
      toast.error(result.error || t('acquireFailed'))
      return false
    }
    setDelivery(result.data as DeliveryPayload)
    setDialogOpen(true)
    toast.success(t('acquireSuccess'))
    void utils.skills.getSkillById.invalidate({ id: skillId })
    void utils.skills.getSkillBySlug.invalidate({ slug: skillSlug })
    void utils.skills.listMyDownloads.invalidate()
    return true
  }, [acquireMutation, skillId, skillSlug, t, utils])

  const handlePrimary = async () => {
    if (!session?.user) return
    setBusy(true)
    try {
      if (priceType === 'paid' && !entitled) {
        const purchase = await purchaseMutation.mutateAsync({ id: skillId })
        if (!purchase.success) {
          if (purchase.needRecharge) {
            setNeedRecharge({
              requiredAmount: purchase.requiredAmount,
              rechargeUrl: purchase.rechargeUrl || Routes.SettingsRecharge,
            })
            toast.error(purchase.error || t('needRecharge'))
            return
          }
          setNeedRecharge(null)
          toast.error(purchase.error || resultError(purchase) || t('purchaseFailed'))
          return
        }
        setNeedRecharge(null)
        if (purchase.data.alreadyOwned) {
          toast.message(t('alreadyOwned'))
        } else {
          toast.success(t('purchaseSuccess', { amount: purchase.data.amount, currency: purchase.data.currency }))
        }
        await entitledQuery.refetch()
      }

      await runAcquire()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('acquireFailed'))
    } finally {
      setBusy(false)
    }
  }

  const downloadUrl =
    delivery?.kind === 'files'
      ? delivery.downloadUrl || `/api/skills/${skillId}/package`
      : delivery?.metaPackage?.downloadUrl || `/api/skills/${skillId}/package`

  const copyText = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(okMsg)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  const handleDownloadZip = async () => {
    try {
      const res = await fetch(downloadUrl, { credentials: 'include' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error((body && typeof body.error === 'string' && body.error) || t('downloadFailed'))
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const match = /filename="?([^"]+)"?/.exec(cd)
      const filename = match?.[1] || `${skillSlug}.zip`
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast.success(t('downloadStarted'))
    } catch {
      toast.error(t('downloadFailed'))
    }
  }

  const showRechargeHint = Boolean(needRecharge)
  const rechargeUrl = needRecharge?.rechargeUrl || Routes.SettingsRecharge

  return (
    <div className='space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm'>
      <div>
        <p className='font-semibold text-foreground text-lg'>{priceLabel}</p>
        <p className='mt-1 text-muted-foreground text-sm'>{billingLabel}</p>
      </div>

      {securityGrade === 'caution' ? (
        <Alert>
          <ShieldAlert className='h-4 w-4' />
          <AlertTitle>{t('cautionTitle')}</AlertTitle>
          <AlertDescription>{t('cautionBody')}</AlertDescription>
        </Alert>
      ) : null}

      {sessionPending ? (
        <Button className='w-full' disabled>
          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          {t('checkingSession')}
        </Button>
      ) : !session?.user ? (
        <LoginWrapper callbackUrl={pathname || `/skills/${skillSlug}`}>
          <Button className='w-full'>{t('loginToContinue')}</Button>
        </LoginWrapper>
      ) : showRechargeHint ? (
        <div className='space-y-2'>
          <Alert>
            <Wallet className='h-4 w-4' />
            <AlertTitle>{t('needRecharge')}</AlertTitle>
            <AlertDescription>
              {t('needRechargeHint', {
                amount: needRecharge?.requiredAmount || priceAmount || '',
              })}
            </AlertDescription>
          </Alert>
          <Button asChild className='w-full'>
            <LocaleLink href={rechargeUrl}>{t('goRecharge')}</LocaleLink>
          </Button>
          <Button
            type='button'
            variant='outline'
            className='w-full'
            disabled={busy}
            onClick={() => void handlePrimary()}
          >
            {busy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
            {t('retryPurchase')}
          </Button>
        </div>
      ) : (
        <Button type='button' className='w-full' disabled={busy || entitledQuery.isLoading} onClick={() => void handlePrimary()}>
          {busy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          {ctaLabel}
        </Button>
      )}

      {priceType === 'paid' && session?.user && entitled ? (
        <p className='text-center text-muted-foreground text-xs'>{t('ownedHint')}</p>
      ) : null}

      <SkillInstallPanel
        asset={{
          id: skillId,
          name: skillTitle,
          slug: skillSlug,
          priceType,
          detailPath: `/skills/${skillSlug}`,
        }}
        locale={locale}
        packageUrl={`/api/skills/${skillId}/package`}
        origin={origin}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-h-[88vh] overflow-y-auto sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('deliveryTitle')}</DialogTitle>
            <DialogDescription>
              {delivery?.title || skillTitle}
              {delivery?.version ? ` · v${delivery.version}` : ''}
            </DialogDescription>
          </DialogHeader>

          {delivery?.riskWarning ? (
            <Alert className='mb-2'>
              <ShieldAlert className='h-4 w-4' />
              <AlertTitle>{t('cautionTitle')}</AlertTitle>
              <AlertDescription>{delivery.riskWarning}</AlertDescription>
            </Alert>
          ) : null}

          {delivery?.kind === 'github' && delivery.githubUrl ? (
            <div className='space-y-3'>
              <p className='text-sm leading-relaxed'>{delivery.installNotes}</p>
              <div className='flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2'>
                <code className='flex-1 truncate font-mono text-xs'>{delivery.githubUrl}</code>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => void copyText(delivery.githubUrl!, t('copiedUrl'))}
                >
                  <Copy className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>
          ) : null}

          {delivery?.kind === 'files' && delivery.files ? (
            <div className='space-y-2'>
              <p className='text-muted-foreground text-sm'>{t('filesHeading', { count: delivery.files.length })}</p>
              <ul className='max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-3 font-mono text-xs'>
                {delivery.files.map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {delivery?.installTips?.length ? (
            <ul className='list-disc space-y-1 pl-5 text-muted-foreground text-sm'>
              {delivery.installTips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          ) : null}

          <DialogFooter className='flex-wrap gap-2 sm:justify-between'>
            <Button type='button' variant='outline' onClick={() => void handleDownloadZip()}>
              <Download className='mr-2 h-4 w-4' />
              {t('downloadZip')}
            </Button>
            <Button type='button' onClick={() => setDialogOpen(false)}>
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
