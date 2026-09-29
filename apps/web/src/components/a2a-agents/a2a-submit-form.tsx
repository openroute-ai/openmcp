'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle2, CircleAlert, Loader2, Search, Send } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Spinner } from '@workspace/ui/components/spinner'
import { LocaleLink } from '@/i18n/navigation'
import {
  emptyListingDraft,
  ListingFields,
  listingPayload,
  TestStepList,
  validatePricing,
  type ListingDraft,
} from '@/components/shared/listing-fields'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { resultError } from '@/lib/gateway/input'
import type { GradedTestResult } from '@/lib/gateway/types'

type AuthType = 'none' | 'bearer' | 'api_key' | 'basic' | 'oauth_client'
type Protocol = '1.0' | '0.3'

/** Mirrors `isValidAssetName` in src/lib/gateway/names.ts. */
const ASSET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const ASSET_NAME_MAX = 80
const DESCRIPTION_MIN = 20

export function A2aSubmitForm() {
  const t = useTranslations('A2ASubmit')
  const utils = trpc.useUtils()
  const payProfile = trpc.providers.getMyProfile.useQuery(undefined, { retry: false })
  const payReady = payProfile.data?.data?.payChannelStatus === 'ready'

  const [step, setStep] = useState<1 | 2>(1)

  const [url, setUrl] = useState('')
  const [assetName, setAssetName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [protocol, setProtocol] = useState<Protocol>('1.0')
  const [authType, setAuthType] = useState<AuthType>('none')
  const [secret, setSecret] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [tokenUrl, setTokenUrl] = useState('')

  const [listing, setListing] = useState<ListingDraft>(emptyListingDraft)

  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState<{
    ok: boolean
    name?: string
    description?: string
    toolCount?: number
    protocol?: string
  } | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<GradedTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const discoverMut = trpc.a2aAgents.discover.useMutation()
  const testMut = trpc.a2aAgents.test.useMutation()
  const connectMut = trpc.a2aAgents.connect.useMutation()
  const publishMut = trpc.a2aAgents.publish.useMutation()

  const authInput = useMemo(
    () => ({
      type: authType,
      secret: authType === 'bearer' || authType === 'api_key' || authType === 'basic' ? secret : null,
      clientId: authType === 'oauth_client' ? clientId : null,
      clientSecret: authType === 'oauth_client' ? clientSecret : null,
      tokenUrl: authType === 'oauth_client' ? tokenUrl : null,
    }),
    [authType, secret, clientId, clientSecret, tokenUrl]
  )

  // Any endpoint, protocol or credential change invalidates a previous pass,
  // otherwise a stale green check would let an untested configuration reach
  // `connect`.
  const resetTest = () => {
    setTestResult(null)
    setTestError(null)
  }

  const nameValid = ASSET_NAME_PATTERN.test(assetName) && assetName.length <= ASSET_NAME_MAX
  const testOk = testResult?.ok === true

  const checkName = trpc.a2aAgents.checkName.useQuery(
    { name: assetName },
    { enabled: nameValid, retry: false, staleTime: 30_000 }
  )
  const nameTaken = checkName.data?.success === true ? checkName.data.taken : false
  const nameChecking = checkName.isFetching

  const handleUrlChange = (next: string) => {
    setUrl(next)
    setDiscovered(null)
    resetTest()
  }

  const handleDiscover = async () => {
    if (!url.trim()) {
      toast.error(t('error.urlRequired'))
      return
    }
    setDiscovering(true)
    setDiscovered(null)
    try {
      const result = await discoverMut.mutateAsync({ url: url.trim(), auth: authInput })
      if (!result.success) {
        setDiscovered({ ok: false })
        toast.error(resultError(result) || t('error.discoverFailed'))
        return
      }
      const data = result.data
      if (!data?.ok) {
        setDiscovered({ ok: false })
        toast.error(t('error.discoverFailed'))
        return
      }
      setDiscovered({
        ok: true,
        name: data.name,
        description: data.description,
        toolCount: data.toolCount,
        protocol: data.protocol,
      })
      // Only fill fields the user has not typed into.
      if (data.name) {
        const slug = data.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
        if (slug && !assetName) setAssetName(slug)
        if (!displayName) setDisplayName(data.name)
      }
      if (data.description && !listing.description) {
        setListing((prev) => ({ ...prev, description: data.description!.slice(0, 2000) }))
      }
      if (data.protocol === '0.3') setProtocol('0.3')
      resetTest()
      toast.success(t('discover.toastSuccess'))
    } catch (error) {
      setDiscovered({ ok: false })
      toast.error(error instanceof Error ? error.message : t('error.discoverFailed'))
    } finally {
      setDiscovering(false)
    }
  }

  const handleTest = async () => {
    if (!url.trim()) {
      toast.error(t('error.urlRequired'))
      return
    }
    if (!nameValid) {
      toast.error(t('assetName.invalid'))
      return
    }
    setTesting(true)
    resetTest()
    try {
      const result = await testMut.mutateAsync({ url: url.trim(), protocol, auth: authInput })
      if (!result.success) {
        setTestError(resultError(result) || t('error.testFailed'))
        return
      }
      setTestResult(result.data)
    } catch (error) {
      setTestError(error instanceof Error ? error.message : t('error.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async () => {
    if (!testOk) {
      toast.error(t('error.testRequired'))
      return
    }
    const problem = validatePricing(listing, DESCRIPTION_MIN)
    if (problem) {
      toast.error(t(problem, { min: DESCRIPTION_MIN }))
      return
    }
    if (listing.priceType === 'paid' && !payReady) {
      toast.error(t('payoutWarning'))
      return
    }

    setSubmitting(true)
    try {
      const payload = listingPayload(listing)
      const connected = await connectMut.mutateAsync({
        assetName,
        displayName: displayName || assetName,
        url: url.trim(),
        protocol,
        auth: authInput,
        healthCheckEnabled: true,
        logoUrl: listing.logoUrl || undefined,
        coverUrl: listing.coverUrl || undefined,
        ...payload,
      })
      if (!connected.success) {
        toast.error(resultError(connected) || t('error.connectFailed'))
        return
      }
      if (!connected.data) {
        toast.error(t('error.connectFailed'))
        return
      }

      const published = await publishMut.mutateAsync({ id: connected.data.id })
      if (!published.success) {
        toast.error(resultError(published) || t('error.publishFailed'))
        return
      }

      toast.success(t('success.title'), { description: t('success.description') })
      resetForNextSubmission()
      void utils.a2aAgents.listMine.invalidate()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('error.submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const resetForNextSubmission = () => {
    setStep(1)
    setUrl('')
    setAssetName('')
    setDisplayName('')
    // Credentials are cleared too: leaving a token in component state after a
    // successful submit would leak into the next listing on the same page.
    setSecret('')
    setClientId('')
    setClientSecret('')
    setTokenUrl('')
    setListing(emptyListingDraft)
    setDiscovered(null)
    resetTest()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cardTitle')}</CardTitle>
        <CardDescription>{t('cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='flex items-center gap-2 text-sm'>
          <span className={step === 1 ? 'font-semibold text-primary' : 'text-muted-foreground'}>
            {t('step1')}
          </span>
          <span className='text-muted-foreground'>→</span>
          <span className={step === 2 ? 'font-semibold text-primary' : 'text-muted-foreground'}>
            {t('step2')}
          </span>
        </div>

        {step === 1 ? (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='a2a-url'>{t('url.label')}</Label>
              <div className='flex gap-2'>
                <Input
                  id='a2a-url'
                  value={url}
                  placeholder={t('url.placeholder')}
                  onChange={(event) => handleUrlChange(event.target.value)}
                />
                <Button
                  type='button'
                  variant='secondary'
                  onClick={() => void handleDiscover()}
                  disabled={discovering || !url.trim()}
                >
                  {discovering ? <Loader2 className='size-4 animate-spin' /> : <Search className='size-4' />}
                  {t('discover.button')}
                </Button>
              </div>
            </div>

            {discovered && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  discovered.ok
                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
                    : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
                }`}
              >
                {discovered.ok ? (
                  <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-emerald-600' />
                ) : (
                  <CircleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
                )}
                <div className='min-w-0 flex-1 space-y-1'>
                  <p className='font-medium'>
                    {discovered.ok ? t('discover.successTitle') : t('discover.failedTitle')}
                  </p>
                  {discovered.ok && (
                    <dl className='grid grid-cols-[auto_1fr] gap-x-2 text-muted-foreground text-xs'>
                      {discovered.name && (
                        <>
                          <dt>{t('discover.nameLabel')}</dt>
                          <dd className='truncate'>{discovered.name}</dd>
                        </>
                      )}
                      {discovered.toolCount !== undefined && (
                        <>
                          <dt>{t('discover.skillCountLabel')}</dt>
                          <dd>{discovered.toolCount}</dd>
                        </>
                      )}
                      {discovered.protocol && (
                        <>
                          <dt>{t('discover.protocolLabel')}</dt>
                          <dd>{discovered.protocol}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </div>
              </div>
            )}

            <div className='space-y-2'>
              <Label htmlFor='a2a-asset-name'>{t('assetName.label')}</Label>
              <Input
                id='a2a-asset-name'
                value={assetName}
                placeholder={t('assetName.placeholder')}
                onChange={(event) => {
                  setAssetName(event.target.value.trim())
                  resetTest()
                }}
              />
              <p className='text-muted-foreground text-xs'>
                {t('assetName.hint', { assetName: assetName || '...' })}
              </p>
              {nameChecking && <p className='text-muted-foreground text-xs'>{t('assetName.checking')}</p>}
              {nameValid && !nameChecking && !nameTaken && (
                <p className='flex items-center gap-1 text-green-600 text-xs'>
                  <CheckCircle2 className='size-3.5' />
                  {t('assetName.available')}
                </p>
              )}
              {nameValid && !nameChecking && nameTaken && (
                <p className='flex items-center gap-1 text-destructive text-xs'>
                  <CircleAlert className='size-3.5' />
                  {t('assetName.taken')}
                </p>
              )}
              {assetName.length > 0 && !nameValid && (
                <p className='text-destructive text-xs'>{t('assetName.invalid')}</p>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='a2a-display-name'>{t('displayName.label')}</Label>
              <Input
                id='a2a-display-name'
                value={displayName}
                placeholder={t('displayName.placeholder')}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>

            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='a2a-protocol'>{t('protocol.label')}</Label>
                <Select
                  value={protocol}
                  onValueChange={(value) => {
                    setProtocol(value as Protocol)
                    resetTest()
                  }}
                >
                  <SelectTrigger id='a2a-protocol'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='1.0'>{t('protocol.v10')}</SelectItem>
                    <SelectItem value='0.3'>{t('protocol.v03')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='a2a-auth'>{t('auth.label')}</Label>
                <Select
                  value={authType}
                  onValueChange={(value) => {
                    setAuthType(value as AuthType)
                    resetTest()
                  }}
                >
                  <SelectTrigger id='a2a-auth'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>{t('auth.none')}</SelectItem>
                    <SelectItem value='api_key'>{t('auth.apiKey')}</SelectItem>
                    <SelectItem value='bearer'>{t('auth.bearer')}</SelectItem>
                    <SelectItem value='basic'>{t('auth.basic')}</SelectItem>
                    <SelectItem value='oauth_client'>{t('auth.oauthClient')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {(authType === 'bearer' || authType === 'api_key') && (
              <div className='space-y-2'>
                <Label htmlFor='a2a-secret'>{t('auth.secret')}</Label>
                <Input
                  id='a2a-secret'
                  type='password'
                  autoComplete='off'
                  value={secret}
                  placeholder={t('auth.secretPlaceholder')}
                  onChange={(event) => {
                    setSecret(event.target.value)
                    resetTest()
                  }}
                />
              </div>
            )}

            {authType === 'basic' && (
              <div className='space-y-2'>
                <Label htmlFor='a2a-basic'>{t('auth.basicLabel')}</Label>
                <Input
                  id='a2a-basic'
                  type='password'
                  autoComplete='off'
                  value={secret}
                  placeholder={t('auth.basicPlaceholder')}
                  onChange={(event) => {
                    setSecret(event.target.value)
                    resetTest()
                  }}
                />
              </div>
            )}

            {authType === 'oauth_client' && (
              <div className='space-y-4'>
                <p className='text-muted-foreground text-sm'>{t('auth.oauthHint')}</p>
                <div className='space-y-2'>
                  <Label htmlFor='a2a-client-id'>{t('auth.clientId')}</Label>
                  <Input
                    id='a2a-client-id'
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value)
                      resetTest()
                    }}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='a2a-client-secret'>{t('auth.clientSecret')}</Label>
                  <Input
                    id='a2a-client-secret'
                    type='password'
                    autoComplete='off'
                    value={clientSecret}
                    onChange={(event) => {
                      setClientSecret(event.target.value)
                      resetTest()
                    }}
                  />
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='a2a-token-url'>{t('auth.tokenUrl')}</Label>
                  <Input
                    id='a2a-token-url'
                    type='url'
                    value={tokenUrl}
                    placeholder={t('auth.tokenUrlPlaceholder')}
                    onChange={(event) => {
                      setTokenUrl(event.target.value)
                      resetTest()
                    }}
                  />
                </div>
              </div>
            )}

            {testError && (
              <Alert variant='destructive'>
                <CircleAlert className='size-4' />
                <AlertTitle>{t('test.failed')}</AlertTitle>
                <AlertDescription>{testError}</AlertDescription>
              </Alert>
            )}

            {testResult && !testError && (
              <div className='rounded-lg border bg-muted/30 p-3'>
                <div className='mb-2 flex items-center gap-2 text-sm'>
                  {testResult.ok ? (
                    <CheckCircle2 className='size-4 shrink-0 text-green-600' />
                  ) : (
                    <CircleAlert className='size-4 shrink-0 text-destructive' />
                  )}
                  <span className={testResult.ok ? 'text-green-600' : 'text-destructive'}>
                    {testResult.ok
                      ? t('test.success', {
                          count: testResult.toolCount ?? 0,
                          ms: testResult.durationMs,
                        })
                      : t('test.failed')}
                  </span>
                </div>
                <TestStepList steps={testResult.steps} t={t} />
              </div>
            )}

            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                variant='secondary'
                onClick={() => void handleTest()}
                disabled={testing || !url.trim() || !nameValid}
              >
                {testing ? <Spinner /> : null}
                {testing ? t('test.running') : t('test.button')}
              </Button>
              <Button type='button' disabled={!testOk} onClick={() => setStep(2)}>
                {t('step1Confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <div className='space-y-4'>
            {listing.priceType === 'paid' && !payReady && (
              <Alert>
                <AlertCircle className='size-4' />
                <AlertDescription className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                  <span>{t('payoutWarning')}</span>
                  <LocaleLink
                    href={Routes.ProviderPayout}
                    className='shrink-0 font-medium underline underline-offset-4'
                  >
                    {t('success.manage')}
                  </LocaleLink>
                </AlertDescription>
              </Alert>
            )}

            <ListingFields
              t={t}
              draft={listing}
              onChange={setListing}
              showLogo
              showCover
              descriptionMin={DESCRIPTION_MIN}
            />

            <div className='flex flex-wrap gap-2'>
              <Button type='button' variant='outline' onClick={() => setStep(1)}>
                {t('step2Back')}
              </Button>
              <Button type='button' onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting ? <Spinner /> : <Send className='size-4' />}
                {submitting ? t('submitting') : t('step2Submit')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
