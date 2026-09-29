'use client'

import { Check, CircleAlert, Loader2, Minus } from 'lucide-react'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { ImageUploader } from '@/components/shared/image-uploader'
import { trpc } from '@/lib/trpc/client'

export type ListingScope = 'public' | 'private' | 'team'
export type ListingPriceType = 'free' | 'paid'
export type ListingBillingModel = '' | 'one_time' | 'subscription' | 'pay_per_call'

export type ListingDraft = {
  description: string
  categoryId: string
  scope: ListingScope
  priceType: ListingPriceType
  billingModel: ListingBillingModel
  priceAmount: string
  unitPrice: string
  logoUrl?: string
  coverUrl?: string
  imageUrl?: string
}

export const emptyListingDraft: ListingDraft = {
  description: '',
  categoryId: '',
  scope: 'public',
  priceType: 'free',
  billingModel: '',
  priceAmount: '',
  unitPrice: '',
}

const NONE = '__none__'

/** Matches the server-side decimal parse before a value is persisted. */
export const parsePrice = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * Shared listing fields for the MCP and Skill submission forms.
 *
 * Pricing is conditional rather than merely hidden: `validatePricing` returns
 * the exact message key for the first problem so both forms reject the same
 * inputs with the same wording, instead of each restating the rules.
 */
export function ListingFields({
  t,
  draft,
  onChange,
  showLogo,
  showCover,
  showImage,
  showCategory = true,
  showDescriptionPlaceholder = true,
  descriptionMin = 0,
  logoMaxBytes = 2 * 1024 * 1024,
  coverMaxBytes = 5 * 1024 * 1024,
  imageMaxBytes = 5 * 1024 * 1024,
}: {
  t: (key: string, values?: Record<string, string | number>) => string
  draft: ListingDraft
  onChange: (next: ListingDraft) => void
  showLogo?: boolean
  showCover?: boolean
  showImage?: boolean
  showCategory?: boolean
  showDescriptionPlaceholder?: boolean
  descriptionMin?: number
  logoMaxBytes?: number
  coverMaxBytes?: number
  imageMaxBytes?: number
}) {
  const categories = trpc.categories.getAllCategories.useQuery(undefined, { retry: false })
  const set = <K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) =>
    onChange({ ...draft, [key]: value })

  const categoryOptions = categories.data?.success ? (categories.data.data ?? []) : []
  const paid = draft.priceType === 'paid'

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='listing-description'>{t('description.label')}</Label>
        <Textarea
          id='listing-description'
          rows={4}
          value={draft.description}
          maxLength={5000}
          placeholder={showDescriptionPlaceholder ? t('description.placeholder') : undefined}
          onChange={(event) => set('description', event.target.value)}
        />
        {descriptionMin > 0 && (
          <p className='text-muted-foreground text-xs'>
            {t('description.hint', { min: descriptionMin })}
          </p>
        )}
      </div>

      {showLogo && (
        <ImageUploader
          label={t('logo.label')}
          hint={t('logo.hint', { max: formatMb(logoMaxBytes) })}
          value={draft.logoUrl}
          maxBytes={logoMaxBytes}
          variant='square'
          onChange={(url) => set('logoUrl', url)}
        />
      )}

      {showCover && (
        <ImageUploader
          label={t('cover.label')}
          hint={t('cover.hint', { max: formatMb(coverMaxBytes) })}
          value={draft.coverUrl}
          maxBytes={coverMaxBytes}
          onChange={(url) => set('coverUrl', url)}
        />
      )}

      {showImage && (
        <ImageUploader
          label={t('image.label')}
          hint={t('image.hint', { max: formatMb(imageMaxBytes) })}
          value={draft.imageUrl}
          maxBytes={imageMaxBytes}
          onChange={(url) => set('imageUrl', url)}
        />
      )}

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        {showCategory && (
          <div className='space-y-2'>
            <Label htmlFor='listing-category'>{t('category.label')}</Label>
            <Select
              value={draft.categoryId || NONE}
              onValueChange={(value) => set('categoryId', value === NONE ? '' : value)}
            >
              <SelectTrigger id='listing-category'>
                <SelectValue placeholder={t('category.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('category.none')}</SelectItem>
                {categoryOptions.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className='space-y-2'>
          <Label htmlFor='listing-scope'>{t('scope.label')}</Label>
          <Select
            value={draft.scope}
            onValueChange={(value) => set('scope', value as ListingScope)}
          >
            <SelectTrigger id='listing-scope'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='public'>{t('scope.public')}</SelectItem>
              <SelectItem value='private'>{t('scope.private')}</SelectItem>
              <SelectItem value='team'>{t('scope.team')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='listing-price-type'>{t('priceType.label')}</Label>
          <Select
            value={draft.priceType}
            onValueChange={(value) => set('priceType', value as ListingPriceType)}
          >
            <SelectTrigger id='listing-price-type'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='free'>{t('priceType.free')}</SelectItem>
              <SelectItem value='paid'>{t('priceType.paid')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {paid && (
          <div className='space-y-2'>
            <Label htmlFor='listing-billing'>{t('billingModel.label')}</Label>
            <Select
              value={draft.billingModel || NONE}
              onValueChange={(value) =>
                set('billingModel', value === NONE ? '' : (value as ListingBillingModel))
              }
            >
              <SelectTrigger id='listing-billing'>
                <SelectValue placeholder={t('billingModel.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('billingModel.none')}</SelectItem>
                <SelectItem value='one_time'>{t('billingModel.oneTime')}</SelectItem>
                <SelectItem value='subscription'>{t('billingModel.subscription')}</SelectItem>
                <SelectItem value='pay_per_call'>{t('billingModel.payPerCall')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {paid && (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <Label htmlFor='listing-price'>{t('priceAmount.label')}</Label>
            <Input
              id='listing-price'
              type='number'
              inputMode='decimal'
              min='0'
              step='0.01'
              value={draft.priceAmount}
              placeholder={t('priceAmount.placeholder')}
              onChange={(event) => set('priceAmount', event.target.value)}
            />
          </div>

          {draft.billingModel === 'pay_per_call' && (
            <div className='space-y-2'>
              <Label htmlFor='listing-unit-price'>{t('unitPrice.label')}</Label>
              <Input
                id='listing-unit-price'
                type='number'
                inputMode='decimal'
                min='0'
                step='0.01'
                value={draft.unitPrice}
                placeholder={t('unitPrice.placeholder')}
                onChange={(event) => set('unitPrice', event.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Returns the i18n key of the first pricing problem, or null when the draft is
 * ready to submit. Kept next to the controls so the rules and the fields that
 * produce them stay in one file.
 */
export function validatePricing(draft: ListingDraft, descriptionMin: number): string | null {
  if (draft.description.trim().length < descriptionMin) return 'error.descriptionTooShort'
  if (draft.priceType !== 'paid') return null
  if (!draft.billingModel) return 'error.billingModelRequired'
  if (!draft.priceAmount.trim()) return 'error.priceRequired'
  if (parsePrice(draft.priceAmount) === null) return 'error.priceInvalid'
  if (draft.billingModel === 'pay_per_call' && draft.unitPrice.trim()) {
    if (parsePrice(draft.unitPrice) === null) return 'error.priceInvalid'
  }
  return null
}

/** Listing payload in the shape the server procedures expect. */
export function listingPayload(draft: ListingDraft) {
  const paid = draft.priceType === 'paid'
  return {
    description: draft.description.trim() || null,
    categoryId: draft.categoryId || null,
    scope: draft.scope,
    priceType: draft.priceType,
    billingModel: paid && draft.billingModel ? draft.billingModel : null,
    priceAmount: paid && draft.priceAmount.trim() ? draft.priceAmount.trim() : null,
    unitPrice:
      paid && draft.billingModel === 'pay_per_call' && draft.unitPrice.trim()
        ? draft.unitPrice.trim()
        : null,
  }
}

const formatMb = (bytes: number): string => `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`

/** Compact status list for the graded connection test. */
export function TestStepList({
  steps,
  t,
}: {
  steps: Array<{ key: string; status: string; detail?: string }>
  t: (key: string) => string
}) {
  if (steps.length === 0) return null
  return (
    <ul className='space-y-1.5'>
      {steps.map((step) => {
        const Icon =
          step.status === 'pass' ? Check : step.status === 'fail' ? CircleAlert : Minus
        const tone =
          step.status === 'pass'
            ? 'text-green-600'
            : step.status === 'fail'
              ? 'text-destructive'
              : 'text-muted-foreground'
        const label = t(`test.steps.${step.key}`)
        return (
          <li key={step.key} className='flex items-start gap-2 text-sm'>
            <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
            <span className='min-w-0 flex-1'>
              <span className={tone}>{label}</span>
              {step.detail && (
                <span className='text-muted-foreground'> — {step.detail}</span>
              )}
            </span>
            {step.status === 'running' && <Loader2 className='size-4 animate-spin' />}
          </li>
        )
      })}
    </ul>
  )
}
