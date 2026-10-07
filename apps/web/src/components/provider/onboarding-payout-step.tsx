'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BadgeCheck, ScanLine, Wallet } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { SmsSliderCaptcha } from '@workspace/sms-captcha/client'
import { LocaleLink, useLocaleRouter } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import {
  KycStatusBanner,
  isPayoutBound,
  readKycMetadata,
  type KycEntityType,
  type KycMetadataLike,
} from './kyc-shared'

/** 大陆手机号，与短信登录 / 绑定手机号同一规则。 */
const PHONE_REGEX = /^1[3-9]\d{9}$/

/**
 * 微信支付服务商拓展二维码。
 *
 * 运营侧拿到真正的拓展码原图后直接替换这张图即可，页面不需要改。
 */
const WECHAT_EXPAND_QR = '/images/wechat-expand-qr.png'

/** 校验手机号时值得单独给一句话的几个错误码。 */
const VERIFY_ERROR_CODES = [
  'INVALID_OTP',
  'OTP_EXPIRED',
  'TOO_MANY_ATTEMPTS',
  'PHONE_NUMBER_EXIST',
] as const
type VerifyErrorCode = (typeof VERIFY_ERROR_CODES)[number]

function isVerifyErrorCode(value: string | undefined): value is VerifyErrorCode {
  return value !== undefined && (VERIFY_ERROR_CODES as readonly string[]).includes(value)
}

const maskPhone = (value: string): string =>
  value.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')

type ProfileLike = {
  entityType: 'individual' | 'company'
  companyName: string | null
  contactName: string | null
  idNumber: string | null
  verificationStatus: string | null
  payChannelType: string | null
  payChannelStatus: string | null
  agreedTerms: boolean
  metadata: unknown
}

/**
 * 个人轨：绑定支付宝账号。
 *
 * 手机号用平台已有的短信 OTP 校验（`phoneNumber.verify` + `updatePhoneNumber`），
 * 校验通过后才把账号写进 `payoutAccounts.alipay`，所以「确认绑定」不是一个
 * 只在前端打勾的空动作。
 */
function AlipayBindingPanel({ profile }: { profile: ProfileLike }) {
  const t = useTranslations('ProviderPage.kyc')
  // 滑块验证的文案与短信登录共用一份，避免两处措辞漂移。
  const tAuth = useTranslations('AuthPage.phoneLogin')
  const utils = trpc.useUtils()
  const meta = readKycMetadata(profile.metadata)
  const savedAccount = meta.payoutAccounts.alipay?.account ?? ''
  const bound = isPayoutBound(meta.payoutAccounts, 'alipay')

  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(savedAccount)
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [captchaOpen, setCaptchaOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bind = trpc.providers.updatePayChannel.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('payoutStep.alipay.success'))
        void utils.providers.getMyProfile.invalidate()
        setOpen(false)
      } else {
        toast.error(t('payoutStep.alipay.bindFailed'), { description: result.error })
      }
    },
    onError: (mutationError) => {
      toast.error(t('payoutStep.alipay.bindFailed'), { description: mutationError.message })
    },
  })

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const sendCode = async (captchaToken: string) => {
    if (!PHONE_REGEX.test(phone)) {
      setError(t('payoutStep.alipay.errors.invalidPhone'))
      return
    }
    setSending(true)
    setError(null)
    try {
      await authClient.phoneNumber.sendOtp(
        { phoneNumber: phone },
        {
          headers: { 'x-temp-captcha-token': captchaToken },
          onSuccess: () => {
            setCountdown(60)
            toast.success(t('payoutStep.alipay.codeSent'))
          },
          onError: (context) => {
            setError(context.error?.message || t('payoutStep.alipay.sendFailed'))
          },
        }
      )
    } catch {
      setError(t('payoutStep.alipay.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  const handleConfirm = async () => {
    setError(null)
    if (!PHONE_REGEX.test(phone)) {
      setError(t('payoutStep.alipay.errors.invalidPhone'))
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setError(t('payoutStep.alipay.errors.codeRequired'))
      return
    }
    if (!agreed) {
      setError(t('payoutStep.alipay.errors.agreementRequired'))
      return
    }

    setVerifying(true)
    try {
      const { error: verifyError } = await authClient.phoneNumber.verify({
        phoneNumber: phone,
        code,
        // 不带这个参数时 better-auth 会把会话切到手机号所属账户，等于什么都没绑定。
        updatePhoneNumber: true,
      })

      if (verifyError && verifyError.code !== 'SUCCESS') {
        const errorCode = verifyError.code as string | undefined
        setError(
          isVerifyErrorCode(errorCode)
            ? t(`payoutStep.alipay.errors.${errorCode}`)
            : verifyError.message?.trim() || t('payoutStep.alipay.errors.verifyFailed')
        )
        return
      }

      bind.mutate({ payChannelType: 'alipay', account: phone, isDefault: true })
    } catch {
      setError(t('payoutStep.alipay.errors.verifyFailed'))
    } finally {
      setVerifying(false)
    }
  }

  const busy = verifying || bind.isPending

  const captchaI18n = {
    title: tAuth('captchaTitle'),
    hint: tAuth('captchaHint'),
    loading: tAuth('captchaLoading'),
    verifying: tAuth('captchaVerifying'),
    codeSent: tAuth('codeSent'),
    challengeFailed: tAuth('captchaChallengeFailed'),
    verifyFailed: tAuth('captchaVerifyFailed'),
    mismatch: tAuth('captchaMismatch'),
    tooManyAttempts: tAuth('captchaTooManyAttempts'),
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Wallet className='size-5' />
          {t('payoutStep.alipay.cardTitle')}
        </CardTitle>
        <CardDescription>{t('payoutStep.alipay.cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {bound ? (
          <Alert>
            <BadgeCheck className='size-4 text-green-600' />
            <AlertTitle>{t('payoutStep.alipay.boundTitle')}</AlertTitle>
            <AlertDescription>
              {t('payoutStep.alipay.boundBody', { phone: maskPhone(savedAccount || phone) })}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>{t('payoutStep.alipay.notBoundTitle')}</AlertTitle>
            <AlertDescription>{t('payoutStep.alipay.notBoundBody')}</AlertDescription>
          </Alert>
        )}

        <Button type='button' onClick={() => setOpen(true)}>
          {bound ? t('payoutStep.alipay.rebind') : t('payoutStep.alipay.open')}
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='w-[420px] max-w-[calc(100vw-2rem)] gap-6 p-6 sm:max-w-[420px]'>
          <DialogHeader>
            <DialogTitle>{t('payoutStep.alipay.title')}</DialogTitle>
            <DialogDescription>{t('payoutStep.alipay.description')}</DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='alipay-phone'>{t('payoutStep.alipay.phone')}</Label>
              <div className='flex items-center gap-2 rounded-md border px-3 transition-colors focus-within:border-ring'>
                <span className='shrink-0 text-muted-foreground text-sm'>+86</span>
                <Input
                  id='alipay-phone'
                  type='tel'
                  inputMode='numeric'
                  maxLength={11}
                  autoComplete='tel'
                  className='h-10 flex-1 border-0 px-0 shadow-none focus-visible:ring-0'
                  placeholder={t('payoutStep.alipay.phonePlaceholder')}
                  value={phone}
                  onChange={(event) => {
                    setError(null)
                    setPhone(event.target.value.replace(/\D/g, ''))
                  }}
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='alipay-code'>{t('payoutStep.alipay.code')}</Label>
              <div className='flex items-center gap-2'>
                <Input
                  id='alipay-code'
                  inputMode='numeric'
                  maxLength={6}
                  autoComplete='one-time-code'
                  className='flex-1'
                  placeholder={t('payoutStep.alipay.codePlaceholder')}
                  value={code}
                  onChange={(event) => {
                    setError(null)
                    setCode(event.target.value.replace(/\D/g, ''))
                  }}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='shrink-0 px-2 text-primary'
                  disabled={countdown > 0 || sending || !PHONE_REGEX.test(phone)}
                  onClick={() => setCaptchaOpen(true)}
                >
                  {countdown > 0
                    ? t('payoutStep.alipay.countdown', { seconds: countdown })
                    : t('payoutStep.alipay.sendCode')}
                </Button>
              </div>
            </div>

            <label className='flex cursor-pointer items-start gap-2 text-sm'>
              <Checkbox
                id='alipay-agreement'
                checked={agreed}
                onCheckedChange={(checked) => {
                  setError(null)
                  setAgreed(checked === true)
                }}
                className='mt-0.5'
              />
              <span>{t('payoutStep.alipay.agreement')}</span>
            </label>

            {error && <p className='text-destructive text-xs'>{error}</p>}
          </div>

          <div className='flex items-center justify-end gap-3'>
            <Button type='button' variant='outline' onClick={() => setOpen(false)}>
              {t('payoutStep.alipay.cancel')}
            </Button>
            <Button type='button' onClick={() => void handleConfirm()} disabled={busy}>
              {busy ? t('payoutStep.alipay.confirming') : t('payoutStep.alipay.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 发短信前必须先过滑块验证：服务端会丢掉没有 captcha token 的 OTP 请求。 */}
      <SmsSliderCaptcha
        open={captchaOpen}
        onOpenChange={setCaptchaOpen}
        i18n={captchaI18n}
        onVerified={(token) => {
          void sendCode(token)
        }}
      />
    </Card>
  )
}

/**
 * 企业轨：微信支付商户入驻。
 *
 * 平台作为微信支付服务商提供拓展二维码，用户扫码按提示完成入驻即可；
 * 商户号拿到后可以回填，作为该通道的账号。
 */
function WeChatMerchantPanel({ profile }: { profile: ProfileLike }) {
  const t = useTranslations('ProviderPage.kyc')
  const utils = trpc.useUtils()
  const meta = readKycMetadata(profile.metadata)
  const bound = isPayoutBound(meta.payoutAccounts, 'wechat')
  const savedAccount = meta.payoutAccounts.wechat?.account ?? ''

  const [merchantId, setMerchantId] = useState(savedAccount)

  const bind = trpc.providers.updatePayChannel.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('payoutStep.wechat.success'))
        void utils.providers.getMyProfile.invalidate()
      } else {
        toast.error(t('payoutStep.wechat.bindFailed'), { description: result.error })
      }
    },
    onError: (mutationError) => {
      toast.error(t('payoutStep.wechat.bindFailed'), { description: mutationError.message })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <ScanLine className='size-5' />
          {t('payoutStep.wechat.cardTitle')}
        </CardTitle>
        <CardDescription>{t('payoutStep.wechat.cardDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {bound ? (
          <Alert>
            <BadgeCheck className='size-4 text-green-600' />
            <AlertTitle>{t('payoutStep.wechat.boundTitle')}</AlertTitle>
            <AlertDescription>{t('payoutStep.wechat.boundBody')}</AlertDescription>
          </Alert>
        ) : null}

        <div className='grid gap-4 sm:grid-cols-[200px_1fr]'>
          <div className='rounded-lg border bg-white p-3'>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={WECHAT_EXPAND_QR}
              alt={t('payoutStep.wechat.qrAlt')}
              className='mx-auto aspect-square w-full max-w-[180px] object-contain'
            />
          </div>
          <ol className='space-y-2 text-sm'>
            <li className='flex gap-2'>
              <span className='font-medium text-primary'>1.</span>
              <span>{t('payoutStep.wechat.step1')}</span>
            </li>
            <li className='flex gap-2'>
              <span className='font-medium text-primary'>2.</span>
              <span>{t('payoutStep.wechat.step2')}</span>
            </li>
            <li className='flex gap-2'>
              <span className='font-medium text-primary'>3.</span>
              <span>{t('payoutStep.wechat.step3')}</span>
            </li>
          </ol>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='wechat-merchant-id'>{t('payoutStep.wechat.merchantId')}</Label>
          <Input
            id='wechat-merchant-id'
            className='max-w-md'
            placeholder={t('payoutStep.wechat.merchantIdPlaceholder')}
            value={merchantId}
            onChange={(event) => setMerchantId(event.target.value)}
          />
          <p className='text-muted-foreground text-xs'>{t('payoutStep.wechat.merchantIdHint')}</p>
        </div>

        <Button
          type='button'
          disabled={bind.isPending}
          onClick={() =>
            bind.mutate({
              payChannelType: 'wechat',
              account: merchantId.trim() || undefined,
              // 商户号还没拿到时用拓展二维码占位，保证该通道有回执可查。
              qrUrl: WECHAT_EXPAND_QR,
              isDefault: true,
            })
          }
        >
          {bind.isPending ? t('payoutStep.wechat.binding') : t('payoutStep.wechat.bind')}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * 入驻第 3 步：收款通道。
 *
 * 个人绑支付宝、企业扫微信拓展码；绑定完成后才允许点「提交审核」，
 * 服务端在 `submitForReview: true` 时才做完整性校验并把状态置为 pending。
 */
export function OnboardingPayoutStep() {
  const t = useTranslations('ProviderPage.kyc')
  const router = useLocaleRouter()
  const utils = trpc.useUtils()
  const { data, isLoading, isError, refetch } = trpc.providers.getMyProfile.useQuery(undefined, {
    retry: false,
  })

  const profile = data?.success === true ? data.data : null
  const status = profile?.verificationStatus ?? null

  const submit = trpc.providers.upsertProfile.useMutation({
    onSuccess: (result) => {
      void utils.providers.getMyProfile.invalidate()
      if (result.success && result.data?.verificationStatus === 'pending') {
        router.replace(Routes.ProviderOnboarding)
        return
      }
      toast.error(
        result.success ? t('payoutStep.submitNoop') : (result.error ?? t('payoutStep.submitFailed'))
      )
    },
    onError: (error) => toast.error(t('payoutStep.submitFailed'), { description: error.message }),
  })

  // 已经在审核中 / 已通过的人不该停在收款这一步。
  useEffect(() => {
    if (status === 'pending' || status === 'verified') {
      router.replace(Routes.ProviderOnboarding)
    }
  }, [status, router])

  if (isLoading) {
    return <Skeleton className='h-64 w-full' />
  }

  if (isError || data?.success === false) {
    return (
      <Alert variant='destructive'>
        <AlertTitle>{t('payoutStep.loadError.title')}</AlertTitle>
        <AlertDescription className='flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <span>{t('payoutStep.loadError.body')}</span>
          <button type='button' onClick={() => void refetch()} className='shrink-0 underline underline-offset-4'>
            {t('payoutStep.loadError.retry')}
          </button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!profile) {
    return (
      <Alert>
        <AlertTitle>{t('payoutStep.missingProfile.title')}</AlertTitle>
        <AlertDescription className='flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <span>{t('payoutStep.missingProfile.body')}</span>
          <LocaleLink href={Routes.ProviderOnboarding} className='shrink-0 underline underline-offset-4'>
            {t('payoutStep.missingProfile.cta')}
          </LocaleLink>
        </AlertDescription>
      </Alert>
    )
  }

  // 重定向已经发出，直接不渲染，避免闪一帧旧内容。
  if (status === 'pending' || status === 'verified') return null

  const entity: KycEntityType = profile.entityType === 'company' ? 'company' : 'individual'
  const meta: KycMetadataLike = readKycMetadata(profile.metadata)
  const channel = entity === 'company' ? 'wechat' : 'alipay'
  const bound = isPayoutBound(meta.payoutAccounts, channel)
  const backHref =
    entity === 'company' ? Routes.ProviderOnboardingCompany : Routes.ProviderOnboardingIndividual
  const canSubmit = bound && profile.agreedTerms && !submit.isPending

  const handleSubmit = () => {
    submit.mutate({
      entityType: entity,
      companyName: profile.companyName,
      contactName: profile.contactName,
      idNumber: profile.idNumber,
      contactPhone: meta.contactPhone || null,
      payChannelType:
        profile.payChannelType === 'wechat' || profile.payChannelType === 'alipay'
          ? profile.payChannelType
          : channel,
      agreedTerms: profile.agreedTerms,
      kycDocuments: meta.kycDocuments,
      submitForReview: true,
    })
  }

  return (
    <div className='space-y-6'>
      <KycStatusBanner profile={profile} />

      {entity === 'company' ? (
        <WeChatMerchantPanel profile={profile} />
      ) : (
        <AlipayBindingPanel profile={profile} />
      )}

      <div className='space-y-3'>
        <Button type='button' className='w-full' onClick={handleSubmit} disabled={!canSubmit}>
          {submit.isPending ? t('submit.saving') : t('submit.label')}
        </Button>

        {!bound && <p className='text-destructive text-xs'>{t('payoutStep.bindRequired')}</p>}
        {bound && !profile.agreedTerms && (
          <p className='text-destructive text-xs'>{t('payoutStep.agreedTermsRequired')}</p>
        )}

        <div className='flex items-center justify-between gap-4 text-sm'>
          <LocaleLink href={backHref} className='text-muted-foreground underline underline-offset-4'>
            {t('payoutStep.back')}
          </LocaleLink>
          <span className='text-muted-foreground text-xs'>{t('payoutStep.hint')}</span>
        </div>
      </div>
    </div>
  )
}
