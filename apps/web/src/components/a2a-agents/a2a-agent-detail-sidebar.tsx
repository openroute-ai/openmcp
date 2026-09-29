'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Check, Copy, Download, Eye } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { LocaleLink } from '@/i18n/navigation'
import {
  type AssetAuthType,
  authLabel,
  billingLabel,
  visibilityLabel,
} from '@/lib/registry-labels'

interface A2aDetailSidebarProps {
  agent: {
    id: string
    author: { name: string; username: string; avatar: string | null }
    category: { name: string; slug: string } | null
    authType: AssetAuthType | null
    protocolVersion: string | null
    scope: string
    priceType: string
    billingModel: string | null
    unitPrice: string | null
    currency: string | null
    agentCardUrl: string | null
    stats: { created: string; updated: string; views: number; downloads: number }
  }
}

export function A2aDetailSidebar({ agent }: A2aDetailSidebarProps) {
  const t = useTranslations('A2APage.detail')
  const price = useTranslations('A2APage.price')
  const lang = useLocale() === 'zh' ? 'zh' : 'en'
  const [copied, setCopied] = useState<'id' | 'card' | null>(null)

  const copy = async (value: string, which: 'id' | 'card') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard can be blocked; leave the button in its idle state rather
      // than claiming a copy happened.
    }
  }

  const amount = agent.unitPrice ?? agent.currency ?? '--'
  const priceLabel =
    agent.priceType === 'free'
      ? t('free')
      : agent.billingModel === 'pay_per_call'
        ? price('payPerCall', { amount: agent.unitPrice ?? '--' })
        : agent.billingModel === 'subscription'
          ? price('subscription', { amount })
          : price('oneTime', { amount })

  const rows: { label: string; value: string }[] = [
    { label: t('auth'), value: authLabel(agent.authType, lang) || '—' },
    { label: t('scope'), value: visibilityLabel(agent.scope, lang) },
    { label: t('pricing'), value: priceLabel },
    ...(agent.billingModel
      ? [{ label: t('billingModel'), value: billingLabel(agent.billingModel, lang) }]
      : []),
  ]

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <div className='mb-4 flex items-center'>
          <Avatar className='mr-4 h-12 w-12'>
            <AvatarImage src={agent.author.avatar ?? undefined} alt={agent.author.name} />
            <AvatarFallback className='text-sm'>{agent.author.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className='min-w-0'>
            <LocaleLink
              href={`/authors/${agent.author.username}`}
              className='block truncate font-medium text-foreground transition-colors hover:text-primary'
            >
              {agent.author.name}
            </LocaleLink>
            <p className='truncate text-muted-foreground text-sm'>{t('author')}</p>
          </div>
        </div>

        {agent.category && (
          <p className='mb-4 text-sm'>
            <span className='text-muted-foreground'>{t('category')}: </span>
            <LocaleLink href={`/categories/${agent.category.slug}`} className='text-primary hover:underline'>
              {agent.category.name}
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

      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <h2 className='mb-3 font-semibold text-base'>{t('idLabel')}</h2>
        <p className='mb-3 break-all font-mono text-muted-foreground text-xs'>{agent.id}</p>
        <button
          type='button'
          onClick={() => copy(agent.id, 'id')}
          className='inline-flex items-center gap-1.5 text-primary text-sm transition-colors hover:underline'
        >
          {copied === 'id' ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
          {copied === 'id' ? t('idCopied') : t('copyId')}
        </button>

        {agent.agentCardUrl && (
          <>
            <p className='mt-4 mb-2 break-all font-mono text-muted-foreground text-xs'>{agent.agentCardUrl}</p>
            <button
              type='button'
              onClick={() => copy(agent.agentCardUrl as string, 'card')}
              className='inline-flex items-center gap-1.5 text-primary text-sm transition-colors hover:underline'
            >
              {copied === 'card' ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
              {copied === 'card' ? t('cardUrlCopied') : t('copyCardUrl')}
            </button>
          </>
        )}
      </div>

      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <h2 className='mb-3 font-semibold text-base'>{t('stats')}</h2>
        <dl className='space-y-2.5 text-sm'>
          <div className='flex items-center justify-between'>
            <dt className='flex items-center gap-1.5 text-muted-foreground'>
              <Eye className='h-3.5 w-3.5' /> {t('views')}
            </dt>
            <dd>{agent.stats.views.toLocaleString()}</dd>
          </div>
          <div className='flex items-center justify-between'>
            <dt className='flex items-center gap-1.5 text-muted-foreground'>
              <Download className='h-3.5 w-3.5' /> {t('downloads')}
            </dt>
            <dd>{agent.stats.downloads.toLocaleString()}</dd>
          </div>
          <div className='flex items-center justify-between'>
            <dt className='text-muted-foreground'>{t('created')}</dt>
            <dd className='text-muted-foreground'>{agent.stats.created}</dd>
          </div>
          {agent.stats.updated && agent.stats.updated !== agent.stats.created && (
            <div className='flex items-center justify-between'>
              <dt className='text-muted-foreground'>{t('updated')}</dt>
              <dd className='text-muted-foreground'>{agent.stats.updated}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
