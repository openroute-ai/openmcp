'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Check, Copy, Download, Eye } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { LocaleLink } from '@/i18n/navigation'
import { AssetPurchasePanel } from '@/components/assets/asset-purchase-panel'
import {
  type AssetAuthType,
  authLabel,
  billingLabel,
  hostingLabel,
  transportLabel,
  visibilityLabel,
} from '@/lib/registry-labels'

interface McpDetailSidebarProps {
  server: {
    id: string
    slug: string
    author: { name: string; username: string; avatar: string | null }
    category: { name: string; slug: string } | null
    transport: string
    authType: AssetAuthType | null
    hosting: string
    scope: string
    endpoint: string | null
    priceType: string
    priceAmount: string | null
    billingModel: string | null
    unitPrice: string | null
    currency: string | null
    /** 详情 query 算好的门禁结论；匿名访客为 null。 */
    access: { allowed: boolean; code?: string; reason?: string } | null
    stats: { created: string; updated: string; views: number; downloads: number }
  }
}

export function McpDetailSidebar({ server }: McpDetailSidebarProps) {
  // 购买面板自己走 createPurchase / hasEntitlement，这里只负责展示与安装信息。
  const t = useTranslations('McpPage.detail')
  const common = useTranslations('Common')
  const lang = useLocale() === 'zh' ? 'zh' : 'en'
  const [copied, setCopied] = useState<'id' | 'endpoint' | null>(null)

  const copy = async (value: string, which: 'id' | 'endpoint') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard can be blocked; leave the button in its idle state rather
      // than claiming a copy happened.
    }
  }

  const priceLabel =
    server.priceType === 'free'
      ? t('free')
      : server.billingModel === 'pay_per_call'
        ? `¥${server.unitPrice ?? '--'}/call`
        : server.billingModel === 'subscription'
          ? `¥${server.unitPrice ?? '--'}/month`
          : `${server.currency === 'CNY' ? '¥' : ''}${server.priceAmount ?? '--'}`

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: t('transport'), value: transportLabel(server.transport, lang) },
    { label: t('auth'), value: authLabel(server.authType, lang) || '—' },
    { label: t('hosting'), value: hostingLabel(server.hosting, lang) },
    { label: t('scope'), value: visibilityLabel(server.scope, lang) },
    { label: t('pricing'), value: priceLabel },
    ...(server.billingModel ? [{ label: t('billingModel'), value: billingLabel(server.billingModel, lang) }] : []),
  ]

  return (
    <div className='space-y-6'>
      {/* 购买面板放在最上面：未购买时 endpoint 已被 router 抹掉，下面那块只剩
          "登录后可查看"，不先给出购买入口用户会以为资产坏了。 */}
      <AssetPurchasePanel
        kind='mcp'
        assetId={server.id}
        assetSlug={server.slug}
        priceType={server.priceType}
        priceAmount={server.priceAmount}
        unitPrice={server.unitPrice}
        currency={server.currency}
        billingModel={server.billingModel as 'one_time' | 'subscription' | 'pay_per_call' | null}
        access={server.access}
      />

      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <div className='mb-4 flex items-center'>
          <Avatar className='mr-4 h-12 w-12'>
            <AvatarImage src={server.author.avatar ?? undefined} alt={server.author.name} />
            <AvatarFallback className='text-sm'>{server.author.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className='min-w-0'>
            <LocaleLink
              href={`/authors/${server.author.username}`}
              className='block truncate font-medium text-foreground transition-colors hover:text-primary'
            >
              {server.author.name}
            </LocaleLink>
            <p className='truncate text-muted-foreground text-sm'>{t('author')}</p>
          </div>
        </div>

        {server.category && (
          <p className='mb-4 text-sm'>
            <span className='text-muted-foreground'>{t('category')}: </span>
            <LocaleLink href={`/categories/${server.category.slug}`} className='text-primary hover:underline'>
              {server.category.name}
            </LocaleLink>
          </p>
        )}

        <dl className='space-y-2.5'>
          {rows.map((row) => (
            <div key={row.label} className='flex items-baseline justify-between gap-3 text-sm'>
              <dt className='shrink-0 text-muted-foreground'>{row.label}</dt>
              <dd className='truncate text-foreground'>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {server.endpoint && (
        <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
          <h2 className='mb-3 font-semibold text-base'>{t('endpoint')}</h2>
          <p className='mb-3 break-all font-mono text-muted-foreground text-xs'>{server.endpoint}</p>
          <button
            type='button'
            onClick={() => copy(server.endpoint as string, 'endpoint')}
            className='inline-flex items-center gap-1.5 text-primary text-sm transition-colors hover:underline'
          >
            {copied === 'endpoint' ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
            {copied === 'endpoint' ? common('copied') : common('copy')}
          </button>
        </div>
      )}

      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <h2 className='mb-3 font-semibold text-base'>{t('stats')}</h2>
        <dl className='space-y-2.5 text-sm'>
          <div className='flex items-center justify-between'>
            <dt className='flex items-center gap-1.5 text-muted-foreground'>
              <Eye className='h-3.5 w-3.5' /> {t('views')}
            </dt>
            <dd>{server.stats.views.toLocaleString()}</dd>
          </div>
          <div className='flex items-center justify-between'>
            <dt className='flex items-center gap-1.5 text-muted-foreground'>
              <Download className='h-3.5 w-3.5' /> {t('downloads')}
            </dt>
            <dd>{server.stats.downloads.toLocaleString()}</dd>
          </div>
          <div className='flex items-center justify-between'>
            <dt className='text-muted-foreground'>{t('created')}</dt>
            <dd className='text-muted-foreground'>{server.stats.created}</dd>
          </div>
          {server.stats.updated && server.stats.updated !== server.stats.created && (
            <div className='flex items-center justify-between'>
              <dt className='text-muted-foreground'>{t('updated')}</dt>
              <dd className='text-muted-foreground'>{server.stats.updated}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
