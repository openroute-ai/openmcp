'use client'

import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Textarea } from '@workspace/ui/components/textarea'
import { CheckCircle2, CircleAlert, Loader2, Plug, Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { resultError } from '@/lib/gateway/input'
import { trpc } from '@/lib/trpc/client'
import {
  ALLOWED_AUTHS,
  ALLOWED_PROTOCOLS,
  type AutoDiscoverResult,
  type GradedTestResult,
  type GradedTestStep,
  type MyAsset,
  type MyAssetType,
} from './assets-data'
import { assetAuthLabelKey, TYPE_KEY } from './assets-ui'

type TestErrorCode = 'auth' | 'timeout' | 'protocol' | 'url'

/** 沙箱试调结果：只描述"这次探测发生了什么"，不写资产状态。 */
interface ConnectionTestResult {
  ok: boolean
  code?: TestErrorCode
  count?: number
  durationMs: number
}

const CATEGORIES = [
  '电商服务',
  '数据分析',
  '客户服务',
  '供应链',
  '翻译',
  '财务',
  '办公效率',
  '开发者工具',
  '采集',
  '其他',
]

interface ConnectAssetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: MyAssetType
  existingSlugs?: string[]
  onCreated: (asset: MyAsset) => void
}

interface ConnectConfig {
  name: string
  url: string
  protocol: string
  auth: string
  secret: string
}

interface PublishConfig {
  description: string
  category: string
  scope: 'public' | 'private' | 'team'
  priceType: 'free' | 'paid'
  billing: string
  amount: string
  unitPrice: string
}

const defaultConnect = (type: MyAssetType): ConnectConfig => ({
  name: '',
  url: '',
  protocol: type === 'a2a' ? '1.0' : type === 'skills' ? 'openai' : 'streamable',
  auth: 'none',
  secret: '',
})

const defaultPublish: PublishConfig = {
  description: '',
  category: '',
  scope: 'public',
  priceType: 'free',
  billing: '',
  amount: '',
  unitPrice: '',
}

export function ConnectAssetDialog({ open, onOpenChange, type, existingSlugs, onCreated }: ConnectAssetDialogProps) {
  const t = useTranslations('Dashboard.myAssets')
  const [step, setStep] = useState<1 | 2>(1)
  const [connect, setConnect] = useState<ConnectConfig>(() => defaultConnect(type))
  const [publish, setPublish] = useState<PublishConfig>(defaultPublish)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [gradedResult, setGradedResult] = useState<GradedTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discoverResult, setDiscoverResult] = useState<AutoDiscoverResult | null>(null)
  const [healthCheck, setHealthCheck] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const mcpDiscover = trpc.mcpServers.discover.useMutation()
  const a2aDiscover = trpc.a2aAgents.discover.useMutation()
  const mcpTest = trpc.mcpServers.test.useMutation()
  const a2aTest = trpc.a2aAgents.test.useMutation()
  const mcpConnect = trpc.mcpServers.connect.useMutation()
  const a2aConnect = trpc.a2aAgents.connect.useMutation()
  const mcpCheckName = trpc.mcpServers.checkName.useQuery(
    { name: connect.name },
    { enabled: type === 'mcp' && /^[a-z0-9][a-z0-9-]*$/.test(connect.name) }
  )
  const a2aCheckName = trpc.a2aAgents.checkName.useQuery(
    { name: connect.name },
    { enabled: type === 'a2a' && /^[a-z0-9][a-z0-9-]*$/.test(connect.name) }
  )

  useEffect(() => {
    if (open) {
      setStep(1)
      setConnect(defaultConnect(type))
      setPublish(defaultPublish)
      setTestResult(null)
      setGradedResult(null)
      setDiscoverResult(null)
      setHealthCheck(false)
      setTesting(false)
      setNameTouched(false)
      setNameError(null)
    }
  }, [open, type])

  useEffect(() => {
    if (testResult?.ok) {
      setTestResult(null)
    }
    if (gradedResult?.ok) {
      setGradedResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect.name, connect.url, connect.protocol, connect.auth])

  const updateConnect = (patch: Partial<ConnectConfig>) => {
    setConnect((prev) => ({ ...prev, ...patch }))
    if (testResult?.ok) setTestResult(null)
  }

  const validateName = (value: string) => {
    setNameTouched(true)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
      setNameError(t('nameInvalid'))
      return
    }
    const taken =
      (existingSlugs?.includes(value) ?? false) ||
      (type === 'mcp'
        ? Boolean(mcpCheckName.data?.success && mcpCheckName.data.taken)
        : Boolean(a2aCheckName.data?.success && a2aCheckName.data.taken))
    if (taken) {
      setNameError(t('nameTaken'))
      return
    }
    setNameError(null)
  }

  const urlRequired = type !== 'skills' && (type === 'a2a' || connect.protocol !== 'stdio')
  const protocolOptions = ALLOWED_PROTOCOLS[type] ?? []
  const authOptions = ALLOWED_AUTHS[type] ?? ['none', 'bearer', 'api_key', 'basic', 'oauth_client', 'custom']
  const authNeedsSecret = ['bearer', 'api_key', 'basic', 'custom'].includes(connect.auth)
  const authInput = {
    type: connect.auth as 'none' | 'bearer' | 'api_key' | 'basic' | 'oauth_client' | 'custom',
    secret: connect.secret || undefined,
  }

  const handleDiscover = async () => {
    if (!connect.url.trim()) return
    setDiscovering(true)
    setDiscoverResult(null)
    try {
      const result =
        type === 'a2a'
          ? await a2aDiscover.mutateAsync({ url: connect.url, auth: authInput })
          : await mcpDiscover.mutateAsync({ url: connect.url, auth: authInput })
      const data = result.success ? result.data : null
      setDiscovering(false)
      setDiscoverResult(data ?? { ok: false, durationMs: 0 })
      if (data?.ok) {
        updateConnect({
          name: (data.name as string | undefined) ?? connect.name,
          protocol: (data.protocol as string | undefined) ?? connect.protocol,
          auth: (data.auth as string | undefined) ?? connect.auth,
        })
        toast.success(`自动发现成功，已预填 ${data.toolCount ?? 0} 个工具`)
      } else {
        toast.error(resultError(result) || '自动发现失败，请手动填写')
      }
    } catch (error) {
      setDiscovering(false)
      toast.error(error instanceof Error ? error.message : '自动发现失败，请手动填写')
    }
  }

  const handleTest = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(connect.name) || (existingSlugs?.includes(connect.name) ?? false)) {
      toast.error(t('nameTaken'))
      return
    }
    setTesting(true)
    setGradedResult(null)
    try {
      const result =
        type === 'a2a'
          ? await a2aTest.mutateAsync({
              url: connect.url,
              protocol: connect.protocol === '0.3' ? '0.3' : '1.0',
              auth: authInput,
            })
          : await mcpTest.mutateAsync({
              url: connect.url,
              transport: connect.protocol === 'sse' ? 'sse' : 'streamable',
              auth: authInput,
            })
      const data = result.success ? result.data : null
      setTesting(false)
      if (!data) {
        toast.error(resultError(result) || t('testFail'))
        return
      }
      setGradedResult(data)
      setTestResult({
        ok: data.ok,
        count: data.toolCount,
        durationMs: data.durationMs,
        code: data.ok
          ? undefined
          : data.steps.find((s) => s.status === 'fail')?.key === 'auth'
            ? 'auth'
            : data.steps.find((s) => s.status === 'fail')?.key === 'protocol'
              ? 'protocol'
              : 'timeout',
      })
    } catch (error) {
      setTesting(false)
      toast.error(error instanceof Error ? error.message : t('testFail'))
    }
  }

  const nameValid =
    !!connect.name && /^[a-z0-9][a-z0-9-]*$/.test(connect.name) && !(existingSlugs?.includes(connect.name) ?? false)
  const canProceedToPublish = (!!gradedResult?.ok || !!testResult?.ok) && nameValid

  const handleSave = async () => {
    if (!testResult?.ok) {
      toast.error(t('mustTestFirst'))
      return
    }
    setSaving(true)
    try {
      const listing = {
        description: publish.description,
        scope: publish.scope,
        priceType: publish.priceType as 'free' | 'paid',
        billingModel: (publish.billing || undefined) as 'one_time' | 'subscription' | 'pay_per_call' | undefined,
        priceAmount: publish.amount || undefined,
        unitPrice: publish.unitPrice || undefined,
      }
      const result =
        type === 'a2a'
          ? await a2aConnect.mutateAsync({
              assetName: connect.name,
              displayName: connect.name,
              url: connect.url,
              protocol: connect.protocol === '0.3' ? '0.3' : '1.0',
              auth: authInput,
              healthCheckEnabled: healthCheck,
              ...listing,
            })
          : await mcpConnect.mutateAsync({
              assetName: connect.name,
              displayName: connect.name,
              url: connect.url,
              transport: connect.protocol === 'sse' ? 'sse' : 'streamable',
              auth: authInput,
              healthCheckEnabled: healthCheck,
              ...listing,
            })
      if (!result.success || !result.data) {
        toast.error(resultError(result) || '保存失败')
        return
      }
      onCreated(result.data)
      toast.success(t('saveSuccess'))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[88vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Plug className='size-5 text-primary' />
            {t('wizardTitle')}
          </DialogTitle>
          <DialogDescription>{t('wizardDesc')}</DialogDescription>
        </DialogHeader>

        <div className='flex items-center gap-2'>
          <StepPill active={step === 1} done={step === 2} label={`1. ${t('stepConnect')}`} />
          <div className='mx-1 h-px flex-1 bg-border' />
          <StepPill active={step === 2} done={false} label={`2. ${t('stepPublish')}`} />
        </div>

        {step === 1 ? (
          <div className='space-y-5'>
            {/* 资产类型（静态，随当前页而定） */}
            <div className='space-y-1.5'>
              <Label>{t('fieldType')}</Label>
              <div className='flex items-center gap-2'>
                {(['mcp', 'a2a', 'skills'] as const).map((item) => (
                  <div
                    key={item}
                    className={`rounded-lg border px-4 py-2 font-medium text-sm ${
                      item === type ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground opacity-50'
                    }`}
                  >
                    {t(TYPE_KEY[item])}
                  </div>
                ))}
              </div>
            </div>

            <div className='space-y-1.5'>
              <Label>{t('fieldName')}</Label>
              <Input
                value={connect.name}
                onChange={(event) => {
                  updateConnect({ name: event.target.value })
                  setNameTouched(false)
                }}
                onBlur={() => {
                  if (!nameError) validateName(connect.name)
                }}
                placeholder='e.g. order-query-server'
              />
              <p className='text-muted-foreground text-xs'>{t('fieldNameHint')}</p>
              {nameTouched && nameError ? <p className='text-destructive text-xs'>{nameError}</p> : null}
            </div>

            {type !== 'skills' ? (
              <div className='space-y-1.5'>
                <Label>
                  {t('fieldUrl')}
                  {urlRequired ? (
                    <span className='text-destructive'> *</span>
                  ) : (
                    <span className='text-muted-foreground'>（{t('protoStdio')} 可留空）</span>
                  )}
                </Label>
                <div className='flex gap-2'>
                  <Input
                    value={connect.url}
                    onChange={(event) => updateConnect({ url: event.target.value })}
                    placeholder={t('fieldUrlPlaceholder')}
                    className='flex-1'
                  />
                  <Button
                    type='button'
                    variant='secondary'
                    onClick={handleDiscover}
                    disabled={discovering || !connect.url.trim()}
                  >
                    {discovering ? (
                      <Loader2 className='mr-2 size-4 animate-spin' />
                    ) : (
                      <Search className='mr-2 size-4' />
                    )}
                    {discovering ? '发现中...' : '自动发现'}
                  </Button>
                </div>
                {discoverResult?.ok ? (
                  <p className='flex items-center gap-1.5 text-emerald-600 text-xs dark:text-emerald-400'>
                    <CheckCircle2 className='size-3.5' />
                    自动发现成功：{discoverResult.toolCount} 个工具，已预填配置
                  </p>
                ) : discoverResult && !discoverResult.ok ? (
                  <p className='flex items-center gap-1.5 text-muted-foreground text-xs'>
                    <CircleAlert className='size-3.5' />
                    自动发现失败，请手动填写
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label>{type === 'a2a' ? t('fieldProtocolA2a') : t('fieldProtocolMcp')}</Label>
                {type === 'skills' ? (
                  <div className='rounded-md border px-3 py-2 text-sm'>OpenAI</div>
                ) : (
                  <Select
                    value={connect.protocol}
                    onValueChange={(value) => {
                      if (type === 'a2a' && value !== '1.0' && value !== '0.3') {
                        toast.error(t('protocolReject'))
                        return
                      }
                      updateConnect({ protocol: value })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='-' />
                    </SelectTrigger>
                    <SelectContent>
                      {(type === 'a2a' ? ['1.0', '0.3'] : protocolOptions).map((option) => (
                        <SelectItem key={option} value={option}>
                          {type === 'a2a'
                            ? option
                            : option === 'streamable'
                              ? t('protoStreamable')
                              : option === 'sse'
                                ? t('protoSse')
                                : t('protoStdio')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className='space-y-1.5'>
                <Label>{t('fieldAuth')}</Label>
                <Select value={connect.auth} onValueChange={(value) => updateConnect({ auth: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder='-' />
                  </SelectTrigger>
                  <SelectContent>
                    {authOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(assetAuthLabelKey(option))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {authNeedsSecret ? (
              <div className='space-y-1.5'>
                <Label>{t('fieldAuthSecret')}</Label>
                <Input
                  type='password'
                  value={connect.secret}
                  onChange={(event) => updateConnect({ secret: event.target.value })}
                  placeholder={t('authSecretPlaceholder')}
                />
              </div>
            ) : null}

            {/* 连接测试 — 分级反馈 */}
            <div className='rounded-lg border p-4'>
              <div className='flex flex-wrap items-center gap-3'>
                <Button type='button' variant='secondary' onClick={handleTest} disabled={testing || !connect.name}>
                  {testing ? <Loader2 className='mr-2 size-4 animate-spin' /> : <Plug className='mr-2 size-4' />}
                  {testing ? t('testRunning') : t('btnTest')}
                </Button>

                {gradedResult?.ok ? (
                  <span className='flex items-center gap-1.5 text-emerald-600 text-sm dark:text-emerald-400'>
                    <CheckCircle2 className='size-4' />
                    {t('testSuccess')}
                    <span className='text-muted-foreground'>
                      {type === 'a2a'
                        ? `· ${t('testSuccessCard', { count: gradedResult.toolCount ?? 0 })}`
                        : `· ${t('testSuccessTools', { count: gradedResult.toolCount ?? 0 })}`}
                    </span>
                    <span className='text-muted-foreground text-xs'>{gradedResult.durationMs}ms</span>
                  </span>
                ) : gradedResult && !gradedResult.ok ? (
                  <span className='flex items-center gap-1.5 text-destructive text-sm'>
                    <CircleAlert className='size-4' />
                    {t('testFail')}
                  </span>
                ) : testResult?.ok ? (
                  <span className='flex items-center gap-1.5 text-emerald-600 text-sm dark:text-emerald-400'>
                    <CheckCircle2 className='size-4' />
                    {t('testSuccess')}
                  </span>
                ) : null}
              </div>

              {/* 分级步骤 */}
              {gradedResult ? (
                <div className='mt-3 space-y-1.5'>
                  {gradedResult.steps.map((step) => (
                    <GradedStepRow key={step.key} step={step} />
                  ))}
                </div>
              ) : null}

              <p className='mt-2 text-muted-foreground text-xs'>{t('testHint')}</p>
            </div>

            {/* 健康检查开关 */}
            <div className='flex items-center gap-3 rounded-lg border p-3'>
              <input
                type='checkbox'
                id='health-check'
                checked={healthCheck}
                onChange={(e) => setHealthCheck(e.target.checked)}
                className='size-4 rounded border-border'
              />
              <label htmlFor='health-check' className='text-sm'>
                启用周期性健康检查
                <span className='ml-2 text-muted-foreground text-xs'>默认每 15 分钟探测，异常时升级到 1 分钟</span>
              </label>
            </div>
          </div>
        ) : (
          <div className='space-y-5'>
            <div className='space-y-1.5'>
              <Label>{t('fieldDescription')}</Label>
              <Textarea
                rows={4}
                value={publish.description}
                onChange={(event) => setPublish((prev) => ({ ...prev, description: event.target.value }))}
                placeholder={t('fieldDescriptionPlaceholder')}
              />
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label>{t('fieldCategory')}</Label>
                <Select
                  value={publish.category}
                  onValueChange={(value) => setPublish((prev) => ({ ...prev, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('fieldCategoryPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-1.5'>
                <Label>{t('fieldScope')}</Label>
                <Select
                  value={publish.scope}
                  onValueChange={(value) => setPublish((prev) => ({ ...prev, scope: value as PublishConfig['scope'] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder='-' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='public'>{t('scopePublic')}</SelectItem>
                    <SelectItem value='private'>{t('scopePrivate')}</SelectItem>
                    <SelectItem value='team'>{t('scopeTeam')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='space-y-3 rounded-lg border p-4'>
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label>{t('fieldPriceType')}</Label>
                  <Select
                    value={publish.priceType}
                    onValueChange={(value) =>
                      setPublish((prev) => ({ ...prev, priceType: value as PublishConfig['priceType'] }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='-' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='free'>{t('priceFree')}</SelectItem>
                      <SelectItem value='paid'>{t('pricePaid')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {publish.priceType === 'paid' ? (
                  <div className='space-y-1.5'>
                    <Label>{t('fieldBilling')}</Label>
                    <Select
                      value={publish.billing}
                      onValueChange={(value) => setPublish((prev) => ({ ...prev, billing: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='-' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='one_time'>{t('billingOnce')}</SelectItem>
                        <SelectItem value='subscription'>{t('billingSub')}</SelectItem>
                        <SelectItem value='pay_per_call'>{t('billingPerCall')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              {publish.priceType === 'paid' ? (
                <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                  <div className='space-y-1.5'>
                    <Label>
                      {publish.billing === 'pay_per_call' ? t('fieldUnitPrice') : t('fieldPrice')}
                      <span className='text-destructive'> *</span>
                    </Label>
                    <Input
                      type='number'
                      step={publish.billing === 'pay_per_call' ? '0.0001' : '0.01'}
                      min='0'
                      value={publish.billing === 'pay_per_call' ? publish.unitPrice : publish.amount}
                      onChange={(event) =>
                        setPublish((prev) =>
                          prev.billing === 'pay_per_call'
                            ? { ...prev, unitPrice: event.target.value }
                            : { ...prev, amount: event.target.value }
                        )
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter className='flex-wrap gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              if (step === 2) setStep(1)
              else onOpenChange(false)
            }}
          >
            <X className='mr-2 size-4' />
            {step === 2 ? t('btnPrev') : t('cancel')}
          </Button>

          {step === 1 ? (
            <Button type='button' onClick={() => setStep(2)} disabled={!canProceedToPublish}>
              {t('btnNext')}
            </Button>
          ) : (
            <Button type='button' onClick={handleSave} disabled={!publish.description.trim() || saving}>
              {saving ? <Loader2 className='mr-2 size-4 animate-spin' /> : null}
              {t('btnSave')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StepPill({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-xs ${
        done || active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {done ? <CheckCircle2 className='size-3.5' /> : <span className='size-1.5 rounded-full bg-current' />}
      {label}
    </span>
  )
}

function GradedStepRow({ step }: { step: GradedTestStep }) {
  const icon =
    step.status === 'pass' ? (
      <CheckCircle2 className='size-4 text-emerald-600 dark:text-emerald-400' />
    ) : step.status === 'fail' ? (
      <CircleAlert className='size-4 text-destructive' />
    ) : step.status === 'running' ? (
      <Loader2 className='size-4 animate-spin text-primary' />
    ) : (
      <span className='size-4 rounded-full border-2 border-muted' />
    )

  return (
    <div
      className={`flex items-center gap-2 text-sm ${step.status === 'fail' ? 'text-destructive' : step.status === 'pending' ? 'text-muted-foreground' : ''}`}
    >
      {icon}
      <span>{step.label}</span>
    </div>
  )
}
