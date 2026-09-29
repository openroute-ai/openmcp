'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { trpc } from '@/lib/trpc/client'
import {
  type KycDocKey,
  type KycDocuments,
  type KycEntityType,
} from './kyc-shared'

interface KycFormOptions {
  entityType: KycEntityType
  /** Company only: skips the authorisation letter when the legal person signs. */
  legalPersonIsAuthorizer?: boolean
}

interface KycFormValues {
  contactName: string
  idNumber: string
  companyName: string
  payChannelType: '' | 'wechat' | 'alipay'
  agreedTerms: boolean
  kycDocuments: KycDocuments
}

type FieldErrors = Partial<Record<keyof KycFormValues, string>>

/**
 * The data-access layer validates KYC server-side and returns fixed Chinese
 * strings. Mapping them here keeps the form localized without weakening that
 * validation, which stays the real gate.
 */
const SERVER_ERROR_KEYS: Record<string, string> = {
  '实名认证审核中，资料已锁定，请等待审核通过或驳回后再修改': 'serverErrors.locked',
  '请上传身份证人像面与国徽面照片': 'serverErrors.idCardMissing',
  '企业实名必须上传营业执照': 'serverErrors.businessLicenseMissing',
  '请上传法人身份证正反面，或（授权文件 + 授权人身份证正反面）': 'serverErrors.companyDocsMissing',
  '请补全授权人身份证正反面': 'serverErrors.authorizerIdMissing',
  '请先选择认证主体类型': 'serverErrors.entityMissing',
  '请完善实名资料（联系人、证件号、收款通道）后再提交': 'serverErrors.detailsIncomplete',
  '保存入驻信息失败': 'serverErrors.saveFailed',
  '用户不存在': 'serverErrors.userMissing',
}

const readDocMap = (metadata: unknown): KycDocuments => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const docs = (metadata as { kycDocuments?: unknown }).kycDocuments
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return {}
  return docs as KycDocuments
}

/**
 * Shared state, validation and submission for the KYC forms.
 *
 * Client-side checks exist to give immediate feedback; they intentionally
 * mirror `validateKycDocuments` / `isCompleteSubmission` so a form the browser
 * accepts is one the server should accept too.
 */
export function useKycForm({ entityType, legalPersonIsAuthorizer }: KycFormOptions) {
  const t = useTranslations('ProviderPage.kyc')

  const profileQuery = trpc.providers.getMyProfile.useQuery(undefined, { retry: false })
  const utils = trpc.useUtils()
  const upsert = trpc.providers.upsertProfile.useMutation({
    onSuccess: () => {
      void utils.providers.getMyProfile.invalidate()
    },
  })

  const profile =
    profileQuery.data?.success === true ? profileQuery.data.data : undefined
  const existingDocs = readDocMap(profile?.metadata)

  const [touched, setTouched] = useState(false)

  const initial = useMemo<KycFormValues>(
    () => ({
      contactName: profile?.contactName ?? '',
      idNumber: profile?.idNumber ?? '',
      companyName: profile?.companyName ?? '',
      payChannelType:
        profile?.payChannelType === 'wechat' || profile?.payChannelType === 'alipay'
          ? profile.payChannelType
          : '',
      agreedTerms: false,
      kycDocuments: { ...existingDocs },
    }),
    // Recomputed only when a fresh profile arrives, so typing is never reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.contactName, profile?.idNumber, profile?.companyName, profile?.payChannelType, profile?.metadata]
  )

  const [draft, setDraft] = useState<KycFormValues | null>(null)
  const values = draft ?? initial

  const setField = useCallback(<K extends keyof KycFormValues>(key: K, value: KycFormValues[K]) => {
    setTouched(true)
    setDraft((current) => {
      const base: KycFormValues = current ?? {
        contactName: '',
        idNumber: '',
        companyName: '',
        payChannelType: '',
        agreedTerms: false,
        kycDocuments: {},
      }
      return { ...base, [key]: value }
    })
  }, [])

  const setDoc = useCallback((key: KycDocKey, url: string | undefined) => {
    setTouched(true)
    setDraft((current) => {
      const docs = { ...(current?.kycDocuments ?? {}) }
      if (url) docs[key] = url
      else delete docs[key]
      return {
        contactName: current?.contactName ?? '',
        idNumber: current?.idNumber ?? '',
        companyName: current?.companyName ?? '',
        payChannelType: current?.payChannelType ?? '',
        agreedTerms: current?.agreedTerms ?? false,
        kycDocuments: docs,
      }
    })
  }, [])

  const errors = useMemo<FieldErrors>(() => {
    const next: FieldErrors = {}
    if (!values.contactName.trim()) next.contactName = t('validation.contactName')
    if (!values.idNumber.trim()) next.idNumber = t('validation.idNumber')
    if (entityType === 'company' && !values.companyName.trim()) {
      next.companyName = t('validation.companyName')
    }
    if (!values.payChannelType) next.payChannelType = t('validation.payChannelType')

    const has = (key: KycDocKey) => Boolean(values.kycDocuments[key]?.trim())

    if (entityType === 'individual') {
      if (!has('idCardFront') || !has('idCardBack')) {
        next.kycDocuments = t('validation.idCardDocs')
      }
    } else {
      if (!has('businessLicense')) {
        next.kycDocuments = t('validation.businessLicense')
      } else if (!has('authorizerIdFront') || !has('authorizerIdBack')) {
        next.kycDocuments = t('validation.authorizerId')
      } else if (!legalPersonIsAuthorizer && !has('authorizationFile')) {
        next.kycDocuments = t('validation.authorizationFile')
      }
    }

    if (!values.agreedTerms) next.agreedTerms = t('validation.agreedTerms')
    return next
  }, [values, entityType, legalPersonIsAuthorizer, t])

  const errorCount = Object.keys(errors).length
  const isSubmitting = upsert.isPending
  const locked = profile?.verificationStatus === 'pending'
  const isVerified = profile?.verificationStatus === 'verified'

  const submit = useCallback(() => {
    if (errorCount > 0) return
    upsert.mutate(
      {
        entityType,
        companyName: entityType === 'company' ? values.companyName.trim() : undefined,
        contactName: values.contactName.trim(),
        idNumber: values.idNumber.trim(),
        payChannelType: values.payChannelType === '' ? 'none' : values.payChannelType,
        agreedTerms: values.agreedTerms,
        kycDocuments: values.kycDocuments,
      },
      { onError: () => void utils.providers.getMyProfile.invalidate() }
    )
  }, [upsert, utils, values, entityType, errorCount])

  const serverError = (() => {
    // `t()` throws on an unknown key, so only translate a message we recognise
    // and otherwise surface the raw server text.
    const localize = (message: string | null | undefined): string | null => {
      if (!message) return null
      const key = SERVER_ERROR_KEYS[message]
      return key ? t(key) : message
    }

    if (upsert.error) return localize(upsert.error.message)
    if (upsert.data && upsert.data.success === false) return localize(upsert.data.error)
    return null
  })()

  const fieldError = (key: keyof KycFormValues): string | undefined =>
    touched ? errors[key] : undefined

  const refresh = useCallback(() => {
    setDraft(null)
    setTouched(false)
    void utils.providers.getMyProfile.invalidate()
  }, [utils])

  return {
    profile,
    values,
    errors,
    locked,
    isVerified,
    isSubmitting,
    isLoading: profileQuery.isLoading,
    loadError: profileQuery.isError,
    serverError,
    touched,
    setField,
    setDoc,
    fieldError,
    submit,
    refresh,
  }
}
