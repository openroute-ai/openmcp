'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { LegalConsent } from './legal-consent'
import {
  KYC_DOCS_FOR_ENTITY,
  KYC_DOCS_FOR_REPRESENTATIVE,
  KycDocUpload,
  KycLockNotice,
  KycStatusBanner,
  KycSubmitButton,
  legalDocumentPath,
  type KycEntityType,
  type KycRepresentative,
} from './kyc-shared'
import { useKycForm } from './use-kyc-form'

const ENTITY: KycEntityType = 'company'

/** The two mutually exclusive branches, in the order they are offered. */
const REPRESENTATIVES = ['legal_person', 'authorized'] as const satisfies readonly KycRepresentative[]

/**
 * Company KYC.
 *
 * The business licence is always required. Beyond that there are two mutually
 * exclusive ways to prove who is acting for the company, and the operator picks
 * one:
 *
 * 1. `legal_person` — the legal person's own ID, front and back.
 * 2. `authorized` — an authorisation letter plus the agent's ID, front and back.
 *
 * Only the selected branch's uploads are shown, and switching branches clears
 * the other branch's documents. `validateKycDocuments` rejects a payload that
 * carries both sets, since a reviewer could not tell which party is the actual
 * counterparty, so leaving stale uploads in place would only fail server-side
 * with an error the form cannot explain.
 */
export function KycCompanyForm() {
  const t = useTranslations('ProviderPage.kyc')
  const locale = useLocale()
  const [representative, setRepresentative] = useState<KycRepresentative | undefined>(undefined)
  const form = useKycForm({ entityType: ENTITY, representative })
  const authorizationLetterTemplate = legalDocumentPath('templates/authorization-letter', locale)

  const onSelectRepresentative = (next: KycRepresentative) => {
    setRepresentative(next)
    // Keep only the newly selected branch, so a half-finished upload on the
    // other branch is discarded rather than submitted.
    form.clearDocsExcept(KYC_DOCS_FOR_REPRESENTATIVE[next].map((doc) => doc.key))
  }

  // 营业执照属于主体材料，与办理人分支无关，固定渲染在办理人身份之前。
  const businessLicenseDoc = KYC_DOCS_FOR_ENTITY.company.find((doc) => doc.key === 'businessLicense')

  // 办理人身份材料来自所选分支，未选择前不展示。
  const branchDocs = representative ? KYC_DOCS_FOR_REPRESENTATIVE[representative] : []

  // The authorisation letter gets a row of its own. It is the one document that
  // is filled in on a template, stamped and scanned, so it carries a download
  // link and needs the full width to sit beside the upload control — in a
  // two-column grid it would be squeezed next to an ID scan, and the two are
  // never the same size.
  const letterDoc = branchDocs.find((doc) => doc.key === 'authorizationFile')
  const identityDocs = branchDocs.filter((doc) => doc.key !== 'authorizationFile')

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
              <Label htmlFor='companyName'>{t('fields.companyName')}</Label>
              <Input
                id='companyName'
                value={form.values.companyName}
                onChange={(event) => form.setField('companyName', event.target.value)}
                placeholder={t('fields.companyNamePlaceholder')}
                autoComplete='organization'
              />
              {form.fieldError('companyName') && (
                <p className='text-destructive text-xs'>{form.fieldError('companyName')}</p>
              )}
            </div>
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
          </div>

          <fieldset className='space-y-3'>
            <legend className='font-medium text-sm'>{t('fields.contactSection')}</legend>
            <div className='space-y-2 max-w-md'>
              <Label htmlFor='contactPhone'>{t('fields.contactPhone')}</Label>
              <Input
                id='contactPhone'
                type='tel'
                inputMode='tel'
                autoComplete='tel'
                maxLength={11}
                value={form.values.contactPhone}
                onChange={(event) => form.setField('contactPhone', event.target.value)}
                placeholder={t('fields.contactPhonePlaceholder')}
              />
              <p className='text-muted-foreground text-xs'>{t('fields.contactPhoneHint')}</p>
              {form.fieldError('contactPhone') && (
                <p className='text-destructive text-xs'>{form.fieldError('contactPhone')}</p>
              )}
            </div>
          </fieldset>

          <div className='space-y-2'>
            <Label htmlFor='idNumber'>{t('fields.taxId')}</Label>
            <Input
              id='idNumber'
              value={form.values.idNumber}
              onChange={(event) => form.setField('idNumber', event.target.value)}
              placeholder={t('fields.taxIdPlaceholder')}
              className='max-w-md'
            />
            <p className='text-muted-foreground text-xs'>{t('fields.taxIdHint')}</p>
            {form.fieldError('idNumber') && (
              <p className='text-destructive text-xs'>{form.fieldError('idNumber')}</p>
            )}
          </div>

          {/* 营业执照是每条办理人分支都必传的材料，放在办理人身份之前，
              这样用户先交主体材料，再决定用哪套身份材料。 */}
          {businessLicenseDoc && (
            <KycDocUpload
              docKey={businessLicenseDoc.key}
              label={t(businessLicenseDoc.labelKey)}
              required
              value={form.values.kycDocuments[businessLicenseDoc.key]}
              onChange={(url) => form.setDoc(businessLicenseDoc.key, url)}
            />
          )}

          <fieldset className='space-y-3'>
            <legend className='font-medium text-sm'>{t('fields.representative')}</legend>
            <p className='text-muted-foreground text-xs'>{t('fields.representativeHint')}</p>

            <div className='grid gap-3 sm:grid-cols-2'>
              {REPRESENTATIVES.map((option) => (
                <label
                  key={option}
                  className='flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm'
                >
                  <input
                    type='radio'
                    name='kycRepresentative'
                    className='mt-0.5 size-4'
                    checked={representative === option}
                    onChange={() => onSelectRepresentative(option)}
                  />
                  <span className='space-y-1'>
                    <span className='block font-medium'>
                      {t(`fields.representative${option === 'legal_person' ? 'LegalPerson' : 'Authorized'}`)}
                    </span>
                    <span className='block text-muted-foreground text-xs'>
                      {t(`fields.representative${option === 'legal_person' ? 'LegalPerson' : 'Authorized'}Detail`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {form.fieldError('kycDocuments') && (
              <p className='text-destructive text-xs'>{form.fieldError('kycDocuments')}</p>
            )}
          </fieldset>

          {identityDocs.length > 0 && (
            <div className='grid gap-4 sm:grid-cols-2'>
              {identityDocs.map((doc) => (
                <KycDocUpload
                  key={doc.key}
                  docKey={doc.key}
                  label={t(doc.labelKey)}
                  hint={doc.hintKey ? t(doc.hintKey) : undefined}
                  required
                  value={form.values.kycDocuments[doc.key]}
                  onChange={(url) => form.setDoc(doc.key, url)}
                />
              ))}
            </div>
          )}

          {letterDoc && (
            <KycDocUpload
              key={letterDoc.key}
              docKey={letterDoc.key}
              label={t(letterDoc.labelKey)}
              hint={letterDoc.hintKey ? t(letterDoc.hintKey) : undefined}
              templateHref={authorizationLetterTemplate}
              required
              value={form.values.kycDocuments[letterDoc.key]}
              onChange={(url) => form.setDoc(letterDoc.key, url)}
            />
          )}

          <p className='text-muted-foreground text-xs'>{t('validation.exclusiveDetail')}</p>

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
