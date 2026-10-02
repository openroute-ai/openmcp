'use client'

import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Loader2, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'
import { LoginWrapper } from '@/components/auth/login-wrapper'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { LocaleLink, useLocalePathname } from '@/i18n/navigation'

type AssetKind = 'mcp' | 'a2a'
type BillingModel = 'one_time' | 'subscription' | 'pay_per_call' | null

interface AssetPurchasePanelProps {
  kind: AssetKind
  assetId: string
  assetSlug: string
  priceType: string
  priceAmount: string | null
  /**
   * 按次付费的单次调用价。`priceAmount` 在 `pay_per_call` 下是空壳——
   * 计费发生在调用链路（settlement 按 `unitPrice` 扣），用它展示会显示 0。
   */
  unitPrice?: string | null
  currency: string | null
  billingModel: BillingModel
  /**
   * 详情 query 已经算好的门禁结论。`null` 表示匿名访客 —— 没查过授权，
   * 不能当成"未购买"，也不能当成"已购买"。
   */
  access: { allowed: boolean; code?: string; reason?: string } | null
}

const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' }

/**
 * MCP / A2A 的购买面板。
 *
 * 与 Skill 的 `SkillPurchase` 分开而不是复用：Skill 购买后要弹出文件交付，
 * 而 MCP/A2A 买的是"接入许可"——交付物就是下面那个 endpoint 输入框，没有
 * 第二个对话框要管。把两种交付方式塞进一个组件里，条件分支会比两个组件还长。
 *
 * 只处理 `one_time`。`pay_per_call` 不需要购买（钱在调用链路上收），
 * `subscription` 尚未上线，两者在详情页都只展示说明，不给购买按钮——
 * 给一个注定失败的按钮比不给更糟。
 */
export function AssetPurchasePanel({
  kind,
  assetId,
  assetSlug,
  priceType,
  priceAmount,
  unitPrice,
  currency,
  billingModel,
  access,
}: AssetPurchasePanelProps) {
  const t = useTranslations('AssetPurchase')
  const pathname = useLocalePathname()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const utils = trpc.useUtils()

  const [busy, setBusy] = useState(false)
  const [recharge, setRecharge] = useState<{ requiredAmount?: string } | null>(null)

  const router = kind === 'mcp' ? trpc.mcpServers : trpc.a2aAgents
  const purchase = router.createPurchase.useMutation()

  const isFree = priceType === 'free'
  const entitled = Boolean(access?.allowed)
  const needsPurchase = !isFree && billingModel === 'one_time' && !entitled

  const symbol = CURRENCY_SYMBOL[currency ?? 'CNY'] ?? `${currency ?? ''} `
  const priceLabel = isFree
    ? t('free')
    : billingModel === 'pay_per_call'
      ? t('perCall', { amount: `${symbol}${(unitPrice ?? priceAmount ?? '0').toString()}` })
      : `${symbol}${(priceAmount ?? '0').toString()}`

  const hintKey =
    billingModel === 'pay_per_call'
      ? 'meteredHint'
      : billingModel === 'subscription'
        ? 'subscriptionUnsupported'
        : entitled
          ? 'ownedHint'
          : 'oneTimeHint'

  const handlePurchase = async () => {
    setBusy(true)
    setRecharge(null)
    try {
      const result = await purchase.mutateAsync({ id: assetId })
      if (!result.success) {
        // 抛错路径只带 `{ success, error }`，充值相关字段只在 handler 的
        // `!result.ok` 分支上，所以按 key 收窄而不是信任整个形状。
        if ('needRecharge' in result && result.needRecharge) {
          setRecharge({ requiredAmount: result.requiredAmount })
          toast.error(result.error || t('needRecharge'))
          return
        }
        toast.error(result.error || t('purchaseFailed'))
        return
      }
      if (result.data.alreadyOwned) {
        toast.message(t('alreadyOwned'))
      } else {
        toast.success(t('purchaseSuccess', { amount: result.data.amount, currency: result.data.currency }))
      }
      await utils.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('purchaseFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm'>
      <div>
        <p className='font-semibold text-foreground text-lg'>{priceLabel}</p>
        <p className='mt-1 text-muted-foreground text-sm'>{t(hintKey)}</p>
      </div>

      {sessionPending ? (
        <Button className='w-full' disabled>
          <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          {t('checkingSession')}
        </Button>
      ) : !session?.user ? (
        !isFree ? (
          <LoginWrapper callbackUrl={pathname || `/${kind === 'mcp' ? 'mcp' : 'a2a'}/${assetSlug}`}>
            <Button className='w-full'>{t('loginToBuy')}</Button>
          </LoginWrapper>
        ) : null
      ) : recharge ? (
        <div className='space-y-2'>
          <Alert>
            <Wallet className='h-4 w-4' />
            <AlertTitle>{t('needRecharge')}</AlertTitle>
            <AlertDescription>
              {t('needRechargeHint', { amount: recharge.requiredAmount ?? priceAmount ?? '' })}
            </AlertDescription>
          </Alert>
          <Button asChild className='w-full'>
            <LocaleLink href={Routes.SettingsRecharge}>{t('goRecharge')}</LocaleLink>
          </Button>
          <Button
            type='button'
            variant='outline'
            className='w-full'
            disabled={busy}
            onClick={() => void handlePurchase()}
          >
            {busy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
            {t('retryPurchase')}
          </Button>
        </div>
      ) : needsPurchase ? (
        <Button type='button' className='w-full' disabled={busy} onClick={() => void handlePurchase()}>
          {busy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          {t('buyNow')}
        </Button>
      ) : null}
    </div>
  )
}