'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ShieldCheck, Upload, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@/lib/utils'
import { uploadFileToStorage } from '@/lib/storage/upload-client'

/**
 * Building blocks shared by the individual and company KYC forms.
 *
 * The required-document rules here deliberately mirror
 * `validateKycDocuments` in `src/web/providers/index.ts`, which is the actual
 * gate: a submission that looks complete in the browser can still be rejected
 * server-side. Where the two could disagree, the server wins.
 */

export type KycEntityType = 'individual' | 'company'

/**
 * Who is signing up on the company's behalf, for company KYC.
 *
 * The two are mutually exclusive: `validateKycDocuments` rejects a payload that
 * carries documents for both, because the reviewer could not otherwise tell
 * which party is the actual counterparty.
 */
export type KycRepresentative = 'legal_person' | 'authorized'

/** Documents required by each branch of company KYC. */
export const KYC_DOCS_FOR_REPRESENTATIVE: Record<
  KycRepresentative,
  { key: KycDocKey; labelKey: string; hintKey?: string }[]
> = {
  legal_person: [
    { key: 'legalPersonIdFront', labelKey: 'docs.legalPersonIdFront' },
    { key: 'legalPersonIdBack', labelKey: 'docs.legalPersonIdBack' },
  ],
  authorized: [
    {
      key: 'authorizationFile',
      labelKey: 'docs.authorizationFile',
      hintKey: 'docs.authorizationFileHint',
    },
    { key: 'authorizerIdFront', labelKey: 'docs.authorizerIdFront' },
    { key: 'authorizerIdBack', labelKey: 'docs.authorizerIdBack' },
  ],
}

export const KYC_DOC_KEYS = [
  'idCardFront',
  'idCardBack',
  'businessLicense',
  'legalPersonIdFront',
  'legalPersonIdBack',
  'authorizationFile',
  'authorizerIdFront',
  'authorizerIdBack',
] as const

export type KycDocKey = (typeof KYC_DOC_KEYS)[number]

export type KycDocuments = Partial<Record<KycDocKey, string>>

/** Accepted by the `kyc` upload scope on the server. */
export const KYC_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'

/** Fields shown for each entity type, with the label translation key. */
export const KYC_DOCS_FOR_ENTITY: Record<
  KycEntityType,
  { key: KycDocKey; labelKey: string; hintKey?: string }[]
> = {
  individual: [
    { key: 'idCardFront', labelKey: 'docs.idCardFront' },
    { key: 'idCardBack', labelKey: 'docs.idCardBack' },
  ],
  company: [
    { key: 'businessLicense', labelKey: 'docs.businessLicense' },
    { key: 'legalPersonIdFront', labelKey: 'docs.legalPersonIdFront' },
    { key: 'legalPersonIdBack', labelKey: 'docs.legalPersonIdBack' },
    { key: 'authorizationFile', labelKey: 'docs.authorizationFile', hintKey: 'docs.authorizationFileHint' },
    { key: 'authorizerIdFront', labelKey: 'docs.authorizerIdFront' },
    { key: 'authorizerIdBack', labelKey: 'docs.authorizerIdBack' },
  ],
}

/**
 * Masks an ID number for display: keeps the first and last few characters so a
 * provider can recognise which document is on file without the full number
 * appearing in a list view.
 */
export const maskIdNumber = (value: string | null | undefined): string => {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed.length <= 8) return trimmed
  return `${trimmed.slice(0, 4)}${'*'.repeat(Math.max(trimmed.length - 8, 4))}${trimmed.slice(-4)}`
}

type KycProfileLike = {
  contactName?: string | null
  idNumber?: string | null
  companyName?: string | null
  entityType?: string | null
  verificationStatus?: string | null
  verificationNote?: string | null
  payChannelType?: string | null
}

/** Renders the KYC progress stepper. */
export function StepIndicator({ status }: { status?: string | null }) {
  const t = useTranslations('ProviderPage.kyc')

  const steps = [
    { key: 'entity', label: t('steps.entity') },
    { key: 'details', label: t('steps.details') },
    { key: 'pending', label: t('steps.pending') },
    { key: 'verified', label: t('steps.verified') },
  ] as const

  let activeIndex = 0
  if (status === 'pending') activeIndex = 2
  else if (status === 'verified') activeIndex = 3
  else if (status === 'rejected') activeIndex = 1

  return (
    <ol className='flex flex-wrap items-center justify-center gap-2 py-4'>
      {steps.map((step, index) => {
        const isActive = index === activeIndex
        const isDone = index < activeIndex
        return (
          <li key={step.key} className='flex items-center gap-2'>
            <div className='flex items-center gap-2'>
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors',
                  isActive && 'border-primary bg-primary text-primary-foreground',
                  isDone && 'border-green-600 bg-green-600 text-white',
                  !isActive && !isDone && 'border-muted-foreground/30 text-muted-foreground'
                )}
              >
                {isDone ? <Check className='h-4 w-4' /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <span aria-hidden className='hidden h-0.5 w-8 bg-muted md:block' />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Status banner describing where the provider currently stands. */
export function KycStatusBanner({ profile }: { profile: KycProfileLike | null | undefined }) {
  const t = useTranslations('ProviderPage.kyc')

  if (!profile?.verificationStatus) return null
  const status = profile.verificationStatus

  const config = {
    unverified: { title: t('status.unverified.title'), body: t('status.unverified.body') },
    pending: { title: t('status.pending.title'), body: t('status.pending.body') },
    verified: { title: t('status.verified.title'), body: t('status.verified.body') },
    rejected: { title: t('status.rejected.title'), body: t('status.rejected.body') },
  }[status as 'unverified' | 'pending' | 'verified' | 'rejected']

  if (!config) return null

  return (
    <Alert>
      <ShieldCheck className='size-4' />
      <AlertTitle>{config.title}</AlertTitle>
      <AlertDescription>
        <p>{config.body}</p>
        {profile.verificationNote && (
          <p className='mt-2 font-medium'>
            {t('status.note')}: {profile.verificationNote}
          </p>
        )}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Shown instead of the form while a submission is under review. The server
 * rejects edits in this state, so offering a form would only produce errors.
 */
export function KycLockNotice() {
  const t = useTranslations('ProviderPage.kyc')
  return (
    <Alert>
      <ShieldCheck className='size-4' />
      <AlertTitle>{t('lock.title')}</AlertTitle>
      <AlertDescription>{t('lock.body')}</AlertDescription>
    </Alert>
  )
}

type KycDocUploadProps = {
  docKey: KycDocKey
  label: string
  hint?: string
  required?: boolean
  /** Existing stored URL, so a resubmission does not force a re-upload. */
  value?: string
  onChange: (url: string | undefined) => void
}

/**
 * Single-document uploader. The file never touches application state before
 * storage accepts it: on success the returned public URL replaces the value
 * that will be persisted on the provider profile.
 */
export function KycDocUpload({
  docKey,
  label,
  hint,
  required,
  value,
  onChange,
}: KycDocUploadProps) {
  const t = useTranslations('ProviderPage.kyc')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const result = await uploadFileToStorage(file, 'kyc')
      onChange(result.url)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : t('upload.failed')
      )
    } finally {
      setBusy(false)
      // Allow re-selecting the same file after a failure.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const isImage = typeof value === 'string' && /\.(jpe?g|png|webp)(\?|$)/i.test(value)

  return (
    <div className='space-y-2'>
      <div className='flex items-center gap-1'>
        <span className='font-medium text-sm'>{label}</span>
        {required && <span className='text-destructive'>*</span>}
      </div>
      {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}

      {value ? (
        <div className='flex items-center gap-3 rounded-md border p-3'>
          {isImage ? (
            // KYC documents are served from the platform's own CDN.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt={label}
              className='size-12 shrink-0 rounded border object-cover'
            />
          ) : (
            <span className='flex size-12 shrink-0 items-center justify-center rounded border bg-muted'>
              <Upload className='size-4 text-muted-foreground' />
            </span>
          )}
          <span className='min-w-0 flex-1 truncate text-muted-foreground text-xs'>
            {t('upload.done')}
          </span>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            onClick={() => onChange(undefined)}
            aria-label={t('upload.remove')}
          >
            <X className='size-4' />
          </Button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef}
            id={`kyc-${docKey}`}
            type='file'
            accept={KYC_ACCEPT}
            className='sr-only'
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
            }}
            disabled={busy}
          />
          <Button
            type='button'
            variant='outline'
            className='w-full'
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Upload className='size-4' />}
            {busy ? t('upload.uploading') : t('upload.choose')}
          </Button>
        </div>
      )}

      {error && <p className='text-destructive text-xs'>{error}</p>}
    </div>
  )
}

/** Submit row with the shared busy/disabled handling. */
export function KycSubmitButton({
  isSubmitting,
  locked,
}: {
  isSubmitting: boolean
  locked?: boolean
}) {
  const t = useTranslations('ProviderPage.kyc')
  return (
    <Button type='submit' className='w-full' disabled={isSubmitting || locked}>
      {isSubmitting && <Spinner />}
      {isSubmitting ? t('submit.sending') : t('submit.label')}
    </Button>
  )
}
