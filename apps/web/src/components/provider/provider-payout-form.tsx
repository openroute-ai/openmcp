'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BadgeCheck, CheckCircle2, Wallet } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'
import { Routes } from '@/lib/routes'
import { uploadFileToStorage } from '@/lib/storage/upload-client'

type Channel = 'wechat' | 'alipay'

type PayoutAccount = {
  account?: string
  accountName?: string | null
  qrUrl?: string | null
}

type PayoutAccounts = Partial<Record<Channel, PayoutAccount>>

const SERVER_ERROR_KEYS: Record<string, string> = {
  '请先完成提供者入驻再绑定收款账户': 'serverErrors.onboardingRequired',
  '请至少填写收款账号或上传收款二维码': 'serverErrors.accountRequired',
}

const readPayoutAccounts = (metadata: unknown): PayoutAccounts => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const accounts = (metadata as { payoutAccounts?: unknown }).payoutAccounts
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return {}
  return accounts as PayoutAccounts
}

const isBound = (entry: PayoutAccount | undefined): boolean =>
  Boolean(entry?.account?.trim() || entry?.qrUrl?.trim())

/**
 * One channel's binding form.
 *
 * The parent renders this with `key={channel}`, so switching tabs remounts it
 * and the fields initialise from the saved values directly. That avoids
 * resetting state from an effect, which would also briefly show the previous
 * channel's account under the newly selected tab.
 */
function PayoutChannelForm({
  channel,
  saved,
  fallbackAccountName,
  willBecomeDefault,
}: {
  channel: Channel
  saved: PayoutAccount | undefined
  fallbackAccountName: string
  willBecomeDefault: boolean
}) {
  const t = useTranslations('ProviderPage.payout')
  const utils = trpc.useUtils()

  const [account, setAccount] = useState(saved?.account ?? '')
  const [accountName, setAccountName] = useState(
    saved?.accountName ?? fallbackAccountName
  )
  const [qrUrl, setQrUrl] = useState<string | undefined>(
    saved?.qrUrl ?? undefined
  )
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const update = trpc.providers.updatePayChannel.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('toast.saved'))
        void utils.providers.getMyProfile.invalidate()
      } else {
        toast.error(t('toast.failed'), { description: result.error })
      }
    },
    onError: (error) => {
      const key = SERVER_ERROR_KEYS[error.message]
      toast.error(t('toast.failed'), {
        description: key ? t(key) : error.message,
      })
    },
  })

  // Mirrors the server's "account or QR code, at least one" rule.
  const missingDetail = !account.trim() && !qrUrl?.trim()
  const canSubmit = !missingDetail && !update.isPending && !uploading

  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadFileToStorage(file, 'payout')
      setQrUrl(result.url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('upload.failed'))
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (missingDetail) return
    update.mutate({
      payChannelType: channel,
      account: account.trim() || undefined,
      accountName: accountName.trim() || null,
      qrUrl: qrUrl?.trim() || null,
      isDefault: willBecomeDefault,
    })
  }

  return (
    <form className='space-y-4' onSubmit={handleSubmit}>
      <div className='space-y-2'>
        <Label htmlFor={`account-${channel}`}>{t('fields.account')}</Label>
        <Input
          id={`account-${channel}`}
          value={account}
          onChange={(event) => {
            setTouched(true)
            setAccount(event.target.value)
          }}
          placeholder={t('fields.accountPlaceholder')}
        />
        <p className='text-muted-foreground text-xs'>
          {t(`fields.accountHint.${channel}`)}
        </p>
      </div>

      <div className='space-y-2'>
        <Label htmlFor={`accountName-${channel}`}>{t('fields.accountName')}</Label>
        <Input
          id={`accountName-${channel}`}
          value={accountName}
          onChange={(event) => {
            setTouched(true)
            setAccountName(event.target.value)
          }}
          placeholder={t('fields.accountNamePlaceholder')}
        />
      </div>

      <div className='space-y-2'>
        <span className='font-medium text-sm'>{t('fields.qrCode')}</span>
        {qrUrl ? (
          <div className='flex items-center gap-3 rounded-md border p-3'>
            {/* Payout QR codes are served from the platform's own CDN. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt={t('fields.qrCode')}
              className='size-16 rounded border object-contain'
            />
            <Button type='button' size='sm' variant='ghost' onClick={() => setQrUrl(undefined)}>
              {t('upload.remove')}
            </Button>
          </div>
        ) : (
          <>
            <input
              id={`qr-${channel}`}
              type='file'
              accept='image/jpeg,image/png,image/webp'
              className='sr-only'
              disabled={uploading}
              onChange={(event) => {
                void handleUpload(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <Button
              type='button'
              variant='outline'
              onClick={() => document.getElementById(`qr-${channel}`)?.click()}
              disabled={uploading}
            >
              {uploading ? t('upload.uploading') : t('upload.choose')}
            </Button>
          </>
        )}
        {uploadError && <p className='text-destructive text-xs'>{uploadError}</p>}
        {touched && missingDetail && (
          <p className='text-destructive text-xs'>{t('validation.accountRequired')}</p>
        )}
      </div>

      {willBecomeDefault && (
        <p className='text-muted-foreground text-xs'>{t('fields.willBecomeDefault')}</p>
      )}

      <Button type='submit' className='w-full' disabled={!canSubmit}>
        {update.isPending ? t('submit.sending') : t('submit.label')}
      </Button>
    </form>
  )
}

/**
 * Payout account binding.
 *
 * `providers.updatePayChannel` is the only call that moves
 * `payChannelStatus` to `ready`, which is what
 * `requireVerifiedProviderForPublish` checks before allowing a paid listing.
 * Both channels can be bound; `isDefault` picks the settlement default.
 */
export function ProviderPayoutForm() {
  const t = useTranslations('ProviderPage.payout')
  const { data, isLoading, isError, refetch } = trpc.providers.getMyProfile.useQuery(
    undefined,
    { retry: false }
  )
  const [channel, setChannel] = useState<Channel>('wechat')

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-7 w-48' />
          <Skeleton className='h-4 w-80' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-10 w-full' />
        </CardContent>
      </Card>
    )
  }

  if (isError || data?.success === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('loadError.title')}</CardTitle>
          <CardDescription>{t('loadError.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type='button' variant='outline' onClick={() => void refetch()}>
            {t('loadError.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data?.success || !data.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('onboardingRequired.title')}</CardTitle>
          <CardDescription>{t('onboardingRequired.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LocaleLink href={Routes.ProviderOnboarding}>
            <Button type='button'>{t('onboardingRequired.cta')}</Button>
          </LocaleLink>
        </CardContent>
      </Card>
    )
  }

  const profile = data.data
  const accounts = readPayoutAccounts(profile.metadata)
  const defaultChannel: Channel | undefined =
    profile.payChannelType === 'wechat' || profile.payChannelType === 'alipay'
      ? profile.payChannelType
      : undefined

  // The server pre-fills the account name from the verified entity when the
  // caller does not supply one, so mirror that here for the initial value.
  const fallbackAccountName =
    profile.entityType === 'company' && profile.companyName
      ? profile.companyName
      : (profile.contactName ?? '')

  const isReady = profile.payChannelStatus === 'ready'

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Wallet className='size-5' />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {isReady && defaultChannel ? (
            <Alert>
              <BadgeCheck className='size-4' />
              <AlertTitle>
                {t('ready.title', { channel: t(`channels.${defaultChannel}`) })}
              </AlertTitle>
              <AlertDescription>
                <div className='flex flex-wrap items-center gap-3'>
                  {(['wechat', 'alipay'] as const).map((type) =>
                    isBound(accounts[type]) ? (
                      <span key={type} className='flex items-center gap-1.5'>
                        <CheckCircle2 className='size-3.5' />
                        {t(`channels.${type}`)}
                        {defaultChannel === type && (
                          <span className='rounded bg-primary/15 px-1.5 py-0.5 text-xs'>
                            {t('ready.defaultBadge')}
                          </span>
                        )}
                      </span>
                    ) : null
                  )}
                </div>
                <p className='mt-2 text-xs'>{t('ready.body')}</p>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertTitle>{t('notReady.title')}</AlertTitle>
              <AlertDescription>{t('notReady.body')}</AlertDescription>
            </Alert>
          )}

          <Tabs value={channel} onValueChange={(value) => setChannel(value as Channel)}>
            <TabsList className='grid w-full grid-cols-2'>
              {(['wechat', 'alipay'] as const).map((type) => (
                <TabsTrigger key={type} value={type}>
                  {t(`channels.${type}`)}
                  {isBound(accounts[type]) && <CheckCircle2 className='ml-1.5 size-3.5' />}
                </TabsTrigger>
              ))}
            </TabsList>

            {(['wechat', 'alipay'] as const).map((type) => (
              <TabsContent key={type} value={type} className='pt-4'>
                <PayoutChannelForm
                  key={type}
                  channel={type}
                  saved={accounts[type]}
                  fallbackAccountName={fallbackAccountName}
                  willBecomeDefault={defaultChannel !== type}
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
