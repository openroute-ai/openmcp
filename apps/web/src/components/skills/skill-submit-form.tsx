'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle2, FileArchive, Loader2, Upload, X } from 'lucide-react'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { LocaleLink } from '@/i18n/navigation'
import {
  emptyListingDraft,
  ListingFields,
  listingPayload,
  validatePricing,
  type ListingDraft,
} from '@/components/shared/listing-fields'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import { resultError } from '@/lib/gateway/input'
import { cn } from '@/lib/utils'

type Mode = 'github' | 'zip'

/** Kept in step with MAX_ZIP_BYTES in app/api/skills/upload-zip/route.ts. */
const MAX_ZIP_BYTES = 50 * 1024 * 1024
const ZIP_MAX_LABEL = '50MB'
const DESCRIPTION_MAX = 5000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Anchored so prose that merely mentions a GitHub URL is rejected. */
const REPO_URL_PATTERN = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)\/?$/

export function SkillSubmitForm() {
  const t = useTranslations('SkillSubmit')
  const utils = trpc.useUtils()
  const payProfile = trpc.providers.getMyProfile.useQuery(undefined, { retry: false })
  const payReady = payProfile.data?.data?.payChannelStatus === 'ready'

  const [mode, setMode] = useState<Mode>('github')
  const [repoUrl, setRepoUrl] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [name, setName] = useState('')
  const [listing, setListing] = useState<ListingDraft>(emptyListingDraft)
  const [submitting, setSubmitting] = useState(false)

  const zipInputRef = useRef<HTMLInputElement>(null)
  const connectGithub = trpc.skills.connectFromGithub.useMutation()
  const checkGithub = trpc.skills.checkGithub.useQuery(
    { repoUrl },
    { enabled: mode === 'github' && REPO_URL_PATTERN.test(repoUrl), retry: false, staleTime: 30_000 }
  )

  /** A stale ZIP must not survive a switch away from ZIP mode and back. */
  const switchMode = (next: Mode) => {
    if (next === 'github') setZipFile(null)
    setMode(next)
  }

  const repoMatch = REPO_URL_PATTERN.exec(repoUrl.trim())
  const repoLabel = repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : null
  const repoInfo = checkGithub.data?.success === true ? checkGithub.data.data : undefined

  const selectZip = (file: File | undefined) => {
    if (!file) return
    const isZip =
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed' ||
      file.name.toLowerCase().endsWith('.zip')
    if (!isZip) {
      toast.error(t('zip.failed'))
      return
    }
    if (file.size > MAX_ZIP_BYTES) {
      toast.error(t('zip.tooLarge', { max: ZIP_MAX_LABEL }))
      return
    }
    setZipFile(file)
  }

  const handleSubmit = async () => {
    // The description is optional here, so the shared minimum is zero; the
    // pricing rules still come from one shared implementation.
    const problem = validatePricing(listing, 0)
    if (problem) {
      toast.error(t(problem, { min: 0, max: DESCRIPTION_MAX }))
      return
    }
    if (listing.priceType === 'paid' && !payReady) {
      toast.error(t('payoutWarning'))
      return
    }

    const payload = listingPayload(listing)

    setSubmitting(true)
    try {
      if (mode === 'github') {
        if (!repoLabel) {
          toast.error(t('error.invalidRepoUrl'))
          return
        }
        const result = await connectGithub.mutateAsync({
          repoUrl: repoUrl.trim(),
          name: name.trim() || undefined,
          ...payload,
          imageUrl: listing.imageUrl ?? null,
        })
        if (!result.success) {
          toast.error(t('error.submitFailed'), {
            description: resultError(result) || t('error.connectGithubFailed'),
          })
          return
        }
        toast.success(t('success.title'), { description: t('success.githubDescription') })
      } else {
        if (!zipFile) {
          toast.error(t('error.zipRequired'))
          return
        }
        const formData = new FormData()
        formData.append('file', zipFile)
        formData.append('name', name.trim())
        formData.append('description', payload.description ?? '')
        formData.append('imageUrl', listing.imageUrl ?? '')
        formData.append('scope', payload.scope)
        formData.append('priceType', payload.priceType)
        if (payload.billingModel) formData.append('billingModel', payload.billingModel)
        if (payload.priceAmount) formData.append('priceAmount', payload.priceAmount)
        if (payload.unitPrice) formData.append('unitPrice', payload.unitPrice)

        const response = await fetch('/api/skills/upload-zip', { method: 'POST', body: formData })
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        if (!response.ok) {
          toast.error(t('zip.failed'), { description: body.error })
          return
        }
        toast.success(t('success.title'), { description: t('success.zipDescription') })
      }

      resetForNextSubmission()
      void utils.skills.listMine.invalidate()
    } catch (error) {
      toast.error(t('error.submitFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const resetForNextSubmission = () => {
    setRepoUrl('')
    setZipFile(null)
    setName('')
    setListing(emptyListingDraft)
    if (zipInputRef.current) zipInputRef.current.value = ''
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('cardTitle')}</CardTitle>
        <CardDescription>{t('cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <div className='space-y-2'>
          <Label>{t('mode.label')}</Label>
          <Tabs value={mode} onValueChange={(value) => switchMode(value as Mode)}>
            <TabsList className='w-fit'>
              <TabsTrigger value='github'>{t('mode.github')}</TabsTrigger>
              <TabsTrigger value='zip'>{t('mode.zip')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {mode === 'github' ? (
          <div className='space-y-2'>
            <Label htmlFor='skill-repo-url'>{t('github.urlLabel')}</Label>
            <Input
              id='skill-repo-url'
              type='url'
              value={repoUrl}
              placeholder={t('github.urlPlaceholder')}
              onChange={(event) => setRepoUrl(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>{t('github.hint')}</p>
            {repoLabel && (
              <p className='flex items-center gap-1 text-xs text-green-600'>
                <CheckCircle2 className='size-3.5' />
                {t('github.valid')}
                <span className='text-muted-foreground'> · {repoLabel}</span>
                {repoInfo?.found && repoInfo.repo && (
                  <span className='text-muted-foreground'>
                    {' '}
                    · ★{repoInfo.repo.stars ?? 0}
                  </span>
                )}
              </p>
            )}
          </div>
        ) : (
          <div className='space-y-2'>
            <Label>{t('zip.heading')}</Label>
            <input
              ref={zipInputRef}
              type='file'
              accept='.zip,application/zip,application/x-zip-compressed'
              className='sr-only'
              onChange={(event) => {
                selectZip(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            {zipFile ? (
              <div className='flex items-center gap-3 rounded-md border p-3'>
                <FileArchive className='size-5 shrink-0 text-muted-foreground' />
                <span className='min-w-0 flex-1 truncate text-sm'>
                  {t('zip.selected', {
                    name: zipFile.name,
                    size: `${(zipFile.size / (1024 * 1024)).toFixed(2)} MB`,
                  })}
                </span>
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label={t('zip.remove')}
                  onClick={() => setZipFile(null)}
                >
                  <X className='size-4' />
                </Button>
              </div>
            ) : (
              <div
                role='button'
                tabIndex={0}
                onClick={() => zipInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    zipInputRef.current?.click()
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setDragActive(true)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragActive(false)
                  selectZip(event.dataTransfer.files?.[0])
                }}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground transition-colors',
                  dragActive && 'border-primary bg-muted'
                )}
              >
                <Upload className='size-6' />
                <span>
                  {t('zip.dropzone')}{' '}
                  <span className='font-medium text-primary underline underline-offset-4'>
                    {t('zip.browse')}
                  </span>
                </span>
                <span className='text-xs'>{t('zip.hint', { max: ZIP_MAX_LABEL })}</span>
              </div>
            )}
          </div>
        )}

        <div className='space-y-2'>
          <Label htmlFor='skill-name'>{t('name.label')}</Label>
          <Input
            id='skill-name'
            value={name}
            placeholder={t('name.placeholder')}
            onChange={(event) => setName(event.target.value)}
          />
          {mode === 'zip' && (
            <p className='text-muted-foreground text-xs'>
              {t('description.hint', { max: DESCRIPTION_MAX })}
            </p>
          )}
        </div>

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
          showImage
          showCategory={false}
          showDescriptionPlaceholder={false}
          imageMaxBytes={IMAGE_MAX_BYTES}
        />

        <div className='rounded-lg border bg-muted/30 p-4'>
          <h3 className='mb-2 font-medium text-sm'>{t('requirements.title')}</h3>
          <ul className='space-y-1.5'>
            {(['metaFile', 'readme', 'noSecrets', 'payout'] as const).map((key) => (
              <li key={key} className='flex items-start gap-2 text-muted-foreground text-sm'>
                <AlertCircle className='mt-0.5 size-4 shrink-0' />
                <span>{t(`requirements.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Button
            type='button'
            onClick={() => void handleSubmit()}
            disabled={submitting || (mode === 'zip' && !zipFile) || (mode === 'github' && !repoLabel)}
          >
            {submitting ? <Spinner /> : mode === 'github' ? null : <Loader2 className='size-4' />}
            {submitting
              ? t('submitting')
              : mode === 'github'
                ? t('submitGithub')
                : t('submitZip')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

