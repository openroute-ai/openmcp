'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { LegalConsent } from './legal-consent'
import {
  KYC_DOCS_FOR_ENTITY,
  KycDocUpload,
  KycLockNotice,
  KycStatusBanner,
  KycSubmitButton,
  type KycEntityType,
} from './kyc-shared'
import { useKycForm } from './use-kyc-form'

const ENTITY: KycEntityType = 'individual'

/**
 * Individual KYC.
 *
 * The document set is fixed by `validateKycDocuments`: an ID card, front and
 * back. This step only collects 资料 and saves a draft (`submitForReview: false`):
 * the 收款通道 step binds the Alipay account through `providers.updatePayChannel`,
 * and only that step submits the application for review.
 */
export function KycIndividualForm() {
  const t = useTranslations('ProviderPage.kyc')
  const form = useKycForm({ entityType: ENTITY })

  return (
    <div className='space-y-6'>
      <KycStatusBanner profile={form.profile} />
      {form.locked ? (
        <KycLockNotice />
      ) : (
        <form
          className='space-y-6'
          onSubmit={(event) => {
            event.preventDefault()
            form.submit()
          }}
        >
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='contactName'>{t('fields.contactName')}</Label>
              <Input
                id='contactName'
                value={form.values.contactName}
                onChange={(event) => form.setField('contactName', event.target.value)}
                placeholder={t('fields.contactNamePlaceholder')}
                autoComplete='name'
              />
              {form.fieldError('contactName') && (
                <p className='text-destructive text-xs'>{form.fieldError('contactName')}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='idNumber'>{t('fields.idNumber')}</Label>
              <Input
                id='idNumber'
                value={form.values.idNumber}
                onChange={(event) => form.setField('idNumber', event.target.value)}
                placeholder={t('fields.idNumberPlaceholder')}
                inputMode='text'
              />
              {form.fieldError('idNumber') && (
                <p className='text-destructive text-xs'>{form.fieldError('idNumber')}</p>
              )}
            </div>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            {KYC_DOCS_FOR_ENTITY[ENTITY].map((doc) => (
              <KycDocUpload
                key={doc.key}
                docKey={doc.key}
                label={t(doc.labelKey)}
                required
                value={form.values.kycDocuments[doc.key]}
                onChange={(url) => form.setDoc(doc.key, url)}
              />
            ))}
          </div>

          <LegalConsent
            checked={form.values.agreedTerms}
            onCheckedChange={(checked) => form.setField('agreedTerms', checked)}
            error={form.fieldError('agreedTerms')}
          />

          {form.serverError && (
            <p className='rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive text-sm'>
              {form.serverError}
            </p>
          )}

          <KycSubmitButton isSubmitting={form.isSubmitting} />
        </form>
      )}

      {form.isVerified && (
        <Button type='button' variant='outline' className='w-full' onClick={form.refresh}>
          {t('actions.refresh')}
        </Button>
      )}
    </div>
  )
}
