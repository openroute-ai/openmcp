'use client'

import { Badge } from '@workspace/ui/components/badge'
import type { AssetVisibility, BillingModel, MyAssetStatus, MyAssetType } from './assets-data'

const STATUS_CLASSES: Record<MyAssetStatus, string> = {
  online: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  reviewing: 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-400',
  published: 'border-transparent bg-primary/15 text-primary',
  rejected: 'border-transparent bg-destructive/15 text-destructive',
  disabled: 'border-transparent bg-muted text-muted-foreground',
  abnormal: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

const DOT_CLASSES: Record<MyAssetStatus, string> = {
  online: 'bg-emerald-500',
  reviewing: 'bg-sky-500',
  published: 'bg-primary',
  rejected: 'bg-destructive',
  disabled: 'bg-muted-foreground',
  abnormal: 'bg-amber-500',
}

export const STATUS_KEY: Record<
  MyAssetStatus,
  'statusOnline' | 'statusReviewing' | 'statusPublished' | 'statusRejected' | 'statusDisabled' | 'statusAbnormal'
> = {
  online: 'statusOnline',
  reviewing: 'statusReviewing',
  published: 'statusPublished',
  rejected: 'statusRejected',
  disabled: 'statusDisabled',
  abnormal: 'statusAbnormal',
}

export const SCOPE_KEY: Record<AssetVisibility, 'scopePublic' | 'scopePrivate' | 'scopeTeam'> = {
  public: 'scopePublic',
  private: 'scopePrivate',
  team: 'scopeTeam',
}

export const BILLING_KEY: Record<BillingModel, 'billingOnce' | 'billingSub' | 'billingPerCall'> = {
  one_time: 'billingOnce',
  subscription: 'billingSub',
  pay_per_call: 'billingPerCall',
}

export const TYPE_KEY: Record<MyAssetType, 'typeMcp' | 'typeA2a' | 'typeSkills'> = {
  mcp: 'typeMcp',
  a2a: 'typeA2a',
  skills: 'typeSkills',
}

export const TITLE_KEY: Record<MyAssetType, 'titleMcp' | 'titleA2a' | 'titleSkills'> = {
  mcp: 'titleMcp',
  a2a: 'titleA2a',
  skills: 'titleSkills',
}

type AuthKey = 'authNone' | 'authBearer' | 'authApiKey' | 'authBasic' | 'authOauthClient' | 'authCustom'

const AUTH_KEY_MAP: Record<string, AuthKey> = {
  none: 'authNone',
  bearer: 'authBearer',
  api_key: 'authApiKey',
  basic: 'authBasic',
  oauth_client: 'authOauthClient',
  oauth: 'authOauthClient',
  custom: 'authCustom',
}

export function assetAuthLabelKey(auth: string): AuthKey {
  return AUTH_KEY_MAP[auth] ?? 'authNone'
}

export function AssetStatusBadge({ status, label }: { status: MyAssetStatus; label: string }) {
  return (
    <Badge variant='outline' className={`gap-1.5 border-0 ${STATUS_CLASSES[status]}`}>
      <span className={`size-1.5 rounded-full ${DOT_CLASSES[status]}`} />
      {label}
    </Badge>
  )
}
