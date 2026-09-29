'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import {
  KYC_DOCS_FOR_ENTITY,
  KycDocUpload,
  KycLockNotice,
  KycStatusBanner,
  KycSubmitButton,
  type KycEntityType,
} from './kyc-shared'
import { useKycForm } from './use-kyc-form'

const ENTITY: KycEntityType = 'company'

/**
 * Company KYC.
 *
 * `validateKycDocuments` requires the business licence plus the authoriser's ID
 * in both branches, and only accepts the authorisation letter as a substitute
 * for the legal person's ID. The checkbox below is the UI expression of exactly
 * that rule: when the legal person is the account operator there is no separate
 * authoriser letter to supply.
 */
export function KycCompanyForm() {
  const t = useTranslations('ProviderPage.kyc')
  const [legalPersonIsAuthorizer, setLegalPersonIsAuthorizer] = useState(false)
  const form = useKycForm({ entityType: ENTITY, legalPersonIsAuthorizer })

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

          <div className='space-y-2'>
            <Label htmlFor='idNumber'>{t('fields.idNumber')}</Label>
            <Input
              id='idNumber'
              value={form.values.idNumber}
              onChange={(event) => form.setField('idNumber', event.target.value)}
              placeholder={t('fields.idNumberPlaceholder')}
              className='max-w-md'
            />
            <p className='text-muted-foreground text-xs'>{t('fields.idNumberHint')}</p>
            {form.fieldError('idNumber') && (
              <p className='text-destructive text-xs'>{form.fieldError('idNumber')}</p>
            )}
          </div>

          <fieldset className='space-y-3'>
            <legend className='font-medium text-sm'>{t('fields.payChannel')}</legend>
            <div className='grid gap-3 sm:grid-cols-2'>
              {(['wechat', 'alipay'] as const).map((channel) => (
                <label
                  key={channel}
                  className='flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm'
                >
                  <input
                    type='radio'
                    name='payChannelType'
                    className='size-4'
                    checked={form.values.payChannelType === channel}
                    onChange={() => form.setField('payChannelType', channel)}
                  />
                  {t(`payChannels.${channel}`)}
                </label>
              ))}
            </div>
            {form.fieldError('payChannelType') && (
              <p className='text-destructive text-xs'>{form.fieldError('payChannelType')}</p>
            )}
          </fieldset>

          <div className='grid gap-4 sm:grid-cols-2'>
            {KYC_DOCS_FOR_ENTITY[ENTITY].map((doc) => {
              // The authorisation letter is only meaningful when a separate
              // party signs on the company's behalf.
              const hidden = doc.key === 'authorizationFile' && legalPersonIsAuthorizer
              if (hidden) return null
              return (
                <KycDocUpload
                  key={doc.key}
                  docKey={doc.key}
                  label={t(doc.labelKey)}
                  hint={doc.hintKey ? t(doc.hintKey) : undefined}
                  required
                  value={form.values.kycDocuments[doc.key]}
                  onChange={(url) => form.setDoc(doc.key, url)}
                />
              )
            })}
          </div>

          <label className='flex cursor-pointer items-start gap-2 text-sm'>
            <Checkbox
              checked={legalPersonIsAuthorizer}
              onCheckedChange={(checked) => setLegalPersonIsAuthorizer(checked === true)}
              className='mt-0.5'
            />
            <span className='text-muted-foreground'>{t('fields.legalPersonIsAuthorizer')}</span>
          </label>

          <div className='space-y-2'>
            <label className='flex cursor-pointer items-start gap-2 text-sm'>
              <Checkbox
                checked={form.values.agreedTerms}
                onCheckedChange={(checked) => form.setField('agreedTerms', checked === true)}
                className='mt-0.5'
              />
              <span className='text-muted-foreground'>{t('fields.agreedTerms')}</span>
            </label>
            {form.fieldError('agreedTerms') && (
              <p className='text-destructive text-xs'>{form.fieldError('agreedTerms')}</p>
            )}
          </div>

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
