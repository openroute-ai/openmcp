'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Separator } from '@workspace/ui/components/separator'
import { Switch } from '@workspace/ui/components/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/components/table'
import { Textarea } from '@workspace/ui/components/textarea'
import { format } from 'date-fns'
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  FlaskConical,
  History,
  KeyRound,
  Loader2,
  Play,
  RotateCw,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  UsersRound,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { resultError } from '@/lib/gateway/input'
import { trpc } from '@/lib/trpc/client'
import { SkillVersions } from '@/components/skills/skill-versions'
import { GatewayAssetVersions } from '@/components/assets/gateway-versions'
import {
  type AssetVisibility,
  type MyAsset,
  type MyAssetType,
  type ScanResult,
  type SecurityFlag,
  type SecurityGrade,
  TRUST_TIER_LABELS,
} from './assets-data'
import { AssetStatusBadge, assetAuthLabelKey, BILLING_KEY, SCOPE_KEY, STATUS_KEY } from './assets-ui'

interface AssetDetailViewProps {
  asset: MyAsset
  type: MyAssetType
  onBack: () => void
  onToggleEnabled: (enabled: boolean) => void
  onTestResult: (ok: boolean) => void
  onVisibilityChange: (visibility: AssetVisibility) => void
}

interface GrantEntry {
  id: string
  name: string
}

function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function AssetDetailView({
  asset,
  type,
  onBack,
  onToggleEnabled,
  onTestResult,
  onVisibilityChange,
}: AssetDetailViewProps) {
  const t = useTranslations('Dashboard.myAssets')
  const [enabledId] = useState(() => `asset-enabled-${Math.random().toString(36).slice(2)}`)
  const statusLabel = t(STATUS_KEY[asset.status])
  const protocolLabel =
    type === 'a2a'
      ? asset.protocol
      : type === 'skills'
        ? 'OpenAI'
        : t(asset.protocol === 'streamable' ? 'protoStreamable' : asset.protocol === 'sse' ? 'protoSse' : 'protoStdio')
  const authLabel = t(assetAuthLabelKey(asset.auth))
  const notCollected = t('notCollected')

  // 真实账本数据；没有计费记录时后端返回 calls=0，面板显示未采集而不是伪造
  const isGateway = asset.type === 'mcp' || asset.type === 'a2a'
  const usageQuery = trpc.assets.getUsage.useQuery(
    { assetType: asset.type === 'a2a' ? 'a2a' : 'mcp', assetId: asset.id },
    { enabled: isGateway }
  )
  const metrics = usageQuery.data?.summary
  const logs = usageQuery.data?.calls ?? []
  const usageLoading = usageQuery.isLoading

  const [testingAgain, setTestingAgain] = useState(false)
  const [lastTestOk, setLastTestOk] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(asset.status !== 'disabled')
  const [visibility, setVisibility] = useState<AssetVisibility>(asset.visibility)
  const [grants, setGrants] = useState<GrantEntry[]>(() =>
    asset.id === 'as_a2a_001' || asset.id === 'as_mcp_001'
      ? [
          { id: 'g1', name: 'key-a1b2…f3f4' },
          { id: 'g2', name: '数据分析组' },
        ]
      : []
  )
  const [grantInput, setGrantInput] = useState('')

  const [sandboxMessage, setSandboxMessage] = useState('')
  const [sandboxRunning, setSandboxRunning] = useState(false)
  const [sandboxResult, setSandboxResult] = useState<{
    ok: boolean
    latencyMs: number
    text: string
    traceId?: string
  } | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const mcpRetest = trpc.mcpServers.retest.useMutation()
  const a2aRetest = trpc.a2aAgents.retest.useMutation()
  const skillsRescan = trpc.skills.rescan.useMutation()
  const mcpInvoke = trpc.mcpServers.invokeTool.useMutation()
  const a2aInvoke = trpc.a2aAgents.invoke.useMutation()

  const handleTestAgain = async () => {
    setTestingAgain(true)
    try {
      if (type === 'mcp') {
        const result = await mcpRetest.mutateAsync({ id: asset.id })
        const ok = Boolean(result.success && result.data?.ok)
        setLastTestOk(ok)
        onTestResult(ok)
        toast[ok ? 'success' : 'error'](ok ? t('testSuccess') : resultError(result) || t('testFail'))
      } else if (type === 'a2a') {
        const result = await a2aRetest.mutateAsync({ id: asset.id })
        const ok = Boolean(result.success && result.data?.ok)
        setLastTestOk(ok)
        onTestResult(ok)
        toast[ok ? 'success' : 'error'](ok ? t('testSuccess') : resultError(result) || t('testFail'))
      } else {
        const result = await skillsRescan.mutateAsync({ id: asset.id })
        setLastTestOk(Boolean(result.success))
        onTestResult(Boolean(result.success))
        toast.success('重新扫描完成')
      }
    } catch (error) {
      setLastTestOk(false)
      onTestResult(false)
      toast.error(error instanceof Error ? error.message : t('testFail'))
    } finally {
      setTestingAgain(false)
    }
  }

  const handleToggle = (value: boolean) => {
    setEnabled(value)
    onToggleEnabled(value)
  }

  const handleVisibility = (value: AssetVisibility) => {
    setVisibility(value)
    onVisibilityChange(value)
  }

  const handleAddGrant = () => {
    if (!grantInput.trim()) return
    setGrants((prev) => [...prev, { id: `g${Date.now()}`, name: grantInput.trim() }])
    setGrantInput('')
  }

  const handleSandboxRun = async () => {
    if (!sandboxMessage.trim()) return
    setSandboxRunning(true)
    try {
      if (type === 'a2a') {
        const result = await a2aInvoke.mutateAsync({ id: asset.id, message: sandboxMessage.trim() })
        if (!result.success || !result.data) throw new Error(resultError(result) || t('resultErr'))
        setSandboxResult({
          ok: result.data.ok,
          latencyMs: result.data.latencyMs,
          text: result.data.text,
          traceId: asset.id,
        })
      } else if (type === 'mcp') {
        const toolName = asset.toolNames[0] || sandboxMessage.trim()
        const result = await mcpInvoke.mutateAsync({ id: asset.id, toolName, args: {} })
        if (!result.success || !result.data) throw new Error(resultError(result) || t('resultErr'))
        setSandboxResult({
          ok: result.data.ok,
          latencyMs: result.data.latencyMs,
          text: result.data.text,
          traceId: asset.id,
        })
      } else {
        setSandboxResult({ ok: false, latencyMs: 0, text: 'Skill 不支持网关试调', traceId: asset.id })
      }
    } catch (error) {
      setSandboxResult({
        ok: false,
        latencyMs: 0,
        text: error instanceof Error ? error.message : t('resultErr'),
        traceId: asset.id,
      })
    } finally {
      setSandboxRunning(false)
    }
  }

  return (
    <div className='space-y-6'>
      <div>
        <button
          type='button'
          onClick={onBack}
          className='mb-3 inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground'
        >
          <ArrowLeft className='size-4' />
          {t('backToDetail')}
        </button>
        <div className='flex flex-wrap items-center gap-3'>
          <h1 className='font-bold text-2xl'>{asset.name}</h1>
          <Badge variant='outline'>{asset.slug}</Badge>
          <AssetStatusBadge status={asset.status} label={statusLabel} />
        </div>
        <p className='mt-1.5 max-w-3xl text-muted-foreground'>{asset.description}</p>
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <Button type='button' variant='secondary' onClick={handleTestAgain} disabled={testingAgain}>
          {testingAgain ? <Loader2 className='mr-2 size-4 animate-spin' /> : <RotateCw className='mr-2 size-4' />}
          {t('btnTestAgain')}
        </Button>
        {lastTestOk !== null ? (
          lastTestOk ? (
            <span className='flex items-center gap-1.5 text-emerald-600 text-sm dark:text-emerald-400'>
              <CheckCircle2 className='size-4' />
              {t('testSuccess')}
            </span>
          ) : (
            <span className='flex items-center gap-1.5 text-destructive text-sm'>
              <CircleAlert className='size-4' />
              {t('testFail')}
            </span>
          )
        ) : null}
        <div className='ml-auto flex items-center gap-2'>
          <Switch id={enabledId} checked={enabled} onCheckedChange={handleToggle} />
          <LabelMini id={enabledId}>{t('toggleLabel')}</LabelMini>
        </div>
      </div>

      {/* 概览 */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>{t('detailTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4'>
            <InfoItem label={t('ovEndpoint')} value={asset.endpoint ?? '—'} mono />
            <InfoItem label={t('ovProtocol')} value={protocolLabel} />
            <InfoItem label={t('ovAuth')} value={authLabel} />
            <InfoItem
              label={t('ovTools')}
              value={asset.tools !== null && asset.tools !== undefined ? String(asset.tools) : '—'}
            />
            <InfoItem label={t('ovVisibility')} value={t(SCOPE_KEY[visibility])} />
            <InfoItem label={t('ovLastTest')} value={asset.lastTestedAt ?? '—'} />
            <InfoItem label={t('ovCreated')} value={formatDate(asset.createdAt)} />
            <InfoItem
              label={t('colPrice')}
              value={
                asset.price.type === 'free'
                  ? t('priceFree')
                  : `${asset.price.model ? t(BILLING_KEY[asset.price.model]) : t('billingSub')} · ¥${asset.price.amount}`
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* 安全扫描详情（仅 Skills） */}
      {type === 'skills' && (asset as import('./assets-data').SkillAsset).scanResult ? (
        <SecurityScanCard
          scanResult={(asset as import('./assets-data').SkillAsset).scanResult!}
          onRescan={async () => {
            setRescanning(true)
            try {
              await skillsRescan.mutateAsync({ id: asset.id })
              toast.success('重新扫描完成')
              onTestResult(true)
            } catch (error) {
              toast.error(error instanceof Error ? error.message : '重新扫描失败')
            } finally {
              setRescanning(false)
            }
          }}
          rescanning={rescanning}
        />
      ) : null}

      {/* 调用观测 */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <History className='size-4 text-primary' />
            {t('statsTitle')}
          </CardTitle>
          <CardDescription>{t('statsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid grid-cols-2 gap-4 md:grid-cols-5'>
            <StatCard label={t('statRequests')} value={metrics ? metrics.calls.toLocaleString() : '—'} />
            {/*
              成功率/错误数不展示：账本只记录成功计费的调用，失败调用没有落库，
              算出来的"成功率"恒等于 100%，比不显示更有害。
            */}
            <StatCard label={t('statSpend')} value={metrics ? `¥${metrics.spend}` : '—'} />
            <StatCard
              label={t('statP50')}
              value={metrics?.p50Ms === null || !metrics ? notCollected : `${metrics.p50Ms}ms`}
            />
            <StatCard
              label={t('statP95')}
              value={metrics?.p95Ms === null || !metrics ? notCollected : `${metrics.p95Ms}ms`}
            />
          </div>

          <div>
            <div className='mb-2 flex items-center gap-2'>
              <ScrollText className='size-4 text-primary' />
              <h3 className='font-medium'>{t('logsTitle')}</h3>
              <span className='text-muted-foreground text-xs'>({t('logsDesc')})</span>
            </div>
            {usageLoading ? (
              <div className='rounded-lg border border-dashed py-10 text-center text-muted-foreground'>
                {t('logLoading')}
              </div>
            ) : logs.length === 0 ? (
              <div className='rounded-lg border border-dashed py-10 text-center text-muted-foreground'>
                {t('logEmpty')}
              </div>
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-40'>{t('logTime')}</TableHead>
                      <TableHead>{t('logCaller')}</TableHead>
                      <TableHead>{t('logMethod')}</TableHead>
                      <TableHead>{t('logStatus')}</TableHead>
                      <TableHead className='text-right'>{t('logLatency')}</TableHead>
                      <TableHead className='text-right'>{t('logCost')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className='font-mono text-xs'>{formatTime(entry.occurredAt)}</TableCell>
                        <TableCell className='font-mono text-xs'>{entry.caller ?? notCollected}</TableCell>
                        <TableCell className='font-mono text-xs'>{entry.callType ?? notCollected}</TableCell>
                        {/*
                          每一行都对应一次真实扣费，因此没有 ok/失败列：
                          账本里根本没有失败调用这一行，显示"成功"是循环论证。
                        */}
                        <TableCell className='font-mono text-xs text-muted-foreground'>
                          {t('logBilledOnly')}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs'>
                          {entry.latencyMs === null ? notCollected : `${entry.latencyMs}ms`}
                        </TableCell>
                        <TableCell className='text-right font-mono text-xs'>¥{entry.cost}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 授权与可见性 */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <KeyRound className='size-4 text-primary' />
            {t('authTitle')}
          </CardTitle>
          <CardDescription>{t('authDesc')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
            <VisibilityOption
              active={visibility === 'public'}
              label={t('scopePublic')}
              desc={t('authPublicDesc')}
              onClick={() => handleVisibility('public')}
            />
            <VisibilityOption
              active={visibility === 'private'}
              label={t('scopePrivate')}
              desc={t('authPrivateDesc')}
              onClick={() => handleVisibility('private')}
            />
            <VisibilityOption
              active={visibility === 'team'}
              label={t('scopeTeam')}
              desc={t('authTeamDesc')}
              onClick={() => handleVisibility('team')}
            />
          </div>

          {visibility === 'team' ? (
            <>
              <Separator />
              <div>
                <p className='mb-2 flex items-center gap-1.5 font-medium text-sm'>
                  <UsersRound className='size-4' />
                  {t('grantedTitle')}
                </p>
                {grants.length === 0 ? (
                  <p className='py-3 text-muted-foreground text-sm'>{t('logEmpty')}</p>
                ) : (
                  <ul className='space-y-2'>
                    {grants.map((grant) => (
                      <li
                        key={grant.id}
                        className='flex items-center justify-between rounded-lg border px-3 py-2 text-sm'
                      >
                        <span className='font-mono'>{grant.name}</span>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => setGrants((prev) => prev.filter((item) => item.id !== grant.id))}
                        >
                          {t('actionDelete')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className='mt-3 flex items-center gap-2'>
                  <Input
                    value={grantInput}
                    onChange={(event) => setGrantInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleAddGrant()
                    }}
                    placeholder={t('grantSearch')}
                  />
                  <Button type='button' variant='secondary' onClick={handleAddGrant}>
                    {t('connectAsset')}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* 沙箱模拟调用 */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <FlaskConical className='size-4 text-primary' />
            {t('sandboxTitle')}
          </CardTitle>
          <CardDescription>{t('sandboxDesc')}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <Textarea
            rows={3}
            value={sandboxMessage}
            onChange={(event) => setSandboxMessage(event.target.value)}
            placeholder={`${t('sandboxPlaceholder')} e.g. ${asset.slug}`}
          />
          <div className='flex items-center gap-3'>
            <Button type='button' onClick={handleSandboxRun} disabled={sandboxRunning || !sandboxMessage.trim()}>
              {sandboxRunning ? <Loader2 className='mr-2 size-4 animate-spin' /> : <Play className='mr-2 size-4' />}
              {sandboxRunning ? t('sandboxRunning') : t('sandboxRun')}
            </Button>
            {sandboxResult ? (
              <span
                className={`inline-flex items-center gap-1.5 text-sm ${
                  sandboxResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                }`}
              >
                {sandboxResult.ok ? <CheckCircle2 className='size-4' /> : <CircleAlert className='size-4' />}
                {sandboxResult.ok ? t('resultOk') : t('resultErr')}
                <span className='text-muted-foreground'>
                  {sandboxResult.latencyMs}ms · {sandboxResult.traceId}
                </span>
              </span>
            ) : null}
          </div>
          {sandboxResult ? (
            <div className='rounded-lg border bg-muted/40 p-4'>
              <p className='mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs'>
                <FlaskConical className='size-3.5' />
                {t('sandboxResultTitle')}
              </p>
              <pre className='max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs'>{sandboxResult.text}</pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Version Management for Skills */}
      {type === 'skills' && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <History className='size-4 text-primary' />
              版本管理
            </CardTitle>
            <CardDescription>管理 Skill 的多个版本，支持发布新版本和回滚</CardDescription>
          </CardHeader>
          <CardContent>
            <SkillVersions skillId={asset.id} isProvider={true} />
          </CardContent>
        </Card>
      )}

      {/*
        网关资产（MCP / A2A）的版本管理。

        快照的是端点/工具/价格等平台侧元数据，不是对方代码——平台拿不到远程
        进程里的东西，能承诺的只有这些字段。
      */}
      {isGateway && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <History className='size-4 text-primary' />
              {t('gatewayVersionsTitle')}
            </CardTitle>
            <CardDescription>{t('gatewayVersionsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <GatewayAssetVersions kind={asset.type as 'mcp' | 'a2a'} assetId={asset.id} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function InfoItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className='min-w-0'>
      <p className='mb-1 text-muted-foreground text-xs'>{label}</p>
      <p className={`truncate font-medium text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function StatCard({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className='rounded-lg border p-4'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className={`mt-1 font-bold text-2xl ${alert ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  )
}

function VisibilityOption({
  active,
  label,
  desc,
  onClick,
}: {
  active: boolean
  label: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
        active ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
      }`}
    >
      <span className='flex items-center gap-2 font-medium text-sm'>
        {active ? (
          <CheckCircle2 className='size-4 text-primary' />
        ) : (
          <ShieldCheck className='size-4 text-muted-foreground' />
        )}
        {label}
      </span>
      <span className='text-muted-foreground text-xs'>{desc}</span>
    </button>
  )
}

function LabelMini({ id, children }: { id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className='text-muted-foreground text-sm'>
      {children}
    </label>
  )
}

function formatDate(value: string): string {
  try {
    return format(new Date(value), 'yyyy-MM-dd')
  } catch {
    return value
  }
}

// ── 安全扫描详情卡片（Skills 专属）──

const GRADE_ICON_MAP: Record<SecurityGrade, typeof ShieldCheck> = {
  safe: ShieldCheck,
  caution: ShieldAlert,
  unsafe: ShieldX,
  reject: ShieldX,
  unknown: History,
}

const GRADE_COLOR_MAP: Record<SecurityGrade, string> = {
  safe: 'text-emerald-600 dark:text-emerald-400',
  caution: 'text-amber-600 dark:text-amber-400',
  unsafe: 'text-orange-600 dark:text-orange-400',
  reject: 'text-destructive',
  unknown: 'text-muted-foreground',
}

const GRADE_BG_MAP: Record<SecurityGrade, string> = {
  safe: 'bg-emerald-500/10',
  caution: 'bg-amber-500/10',
  unsafe: 'bg-orange-500/10',
  reject: 'bg-destructive/10',
  unknown: 'bg-muted',
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
}

function SecurityScanCard({
  scanResult,
  onRescan,
  rescanning,
}: {
  scanResult: ScanResult
  onRescan: () => void
  rescanning: boolean
}) {
  const Icon = GRADE_ICON_MAP[scanResult.grade]
  return (
    <Card>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <ShieldCheck className='size-4 text-primary' />
          安全扫描详情
        </CardTitle>
        <CardDescription>两阶段扫描结果（规则扫描 + LLM 复核）</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {/* 评级总览 */}
        <div className={`flex items-center gap-3 rounded-lg p-4 ${GRADE_BG_MAP[scanResult.grade]}`}>
          <Icon className={`size-6 ${GRADE_COLOR_MAP[scanResult.grade]}`} />
          <div className='flex-1'>
            <p className={`font-semibold text-sm ${GRADE_COLOR_MAP[scanResult.grade]}`}>
              {scanResult.grade.toUpperCase()}
            </p>
            <p className='text-muted-foreground text-xs'>
              信任层级：Tier {scanResult.trustTier} ({TRUST_TIER_LABELS[scanResult.trustTier]}) · 规则集{' '}
              {scanResult.rulesVersion} · 扫描 {scanResult.fileCount} 个文件 · {scanResult.scannedAt}
            </p>
          </div>
          <Button type='button' variant='secondary' size='sm' onClick={onRescan} disabled={rescanning}>
            {rescanning ? (
              <>
                <Loader2 className='mr-2 size-3.5 animate-spin' />
                重新扫描中...
              </>
            ) : (
              <>
                <RotateCw className='mr-2 size-3.5' />
                重新扫描
              </>
            )}
          </Button>
        </div>

        {/* 命中 flag 列表 */}
        {scanResult.flags.length > 0 ? (
          <div>
            <h4 className='mb-2 font-medium text-sm'>命中风险标记（{scanResult.flags.length}）</h4>
            <div className='space-y-2'>
              {scanResult.flags.map((flag) => (
                <SecurityFlagRow key={flag.name} flag={flag} />
              ))}
            </div>
          </div>
        ) : (
          <div className='flex items-center gap-2 rounded-lg bg-emerald-500/5 px-4 py-3 text-emerald-600 text-sm dark:text-emerald-400'>
            <CheckCircle2 className='size-4' />
            未发现任何风险模式
          </div>
        )}

        {/* LLM 分析 */}
        {scanResult.llmAnalysis ? (
          <div className='rounded-lg border p-4'>
            <h4 className='mb-2 flex items-center gap-1.5 font-medium text-sm'>
              <ShieldCheck className='size-4 text-primary' />
              LLM 语义复核（DeepSeek V4）
            </h4>
            <p className='mb-2 text-muted-foreground text-sm'>{scanResult.llmAnalysis.riskSummary}</p>
            <div className='mb-2 flex items-center gap-4 text-muted-foreground text-xs'>
              <span>LLM 评级：{scanResult.llmAnalysis.grade}</span>
              <span>置信度：{(scanResult.llmAnalysis.confidence * 100).toFixed(0)}%</span>
            </div>
            {scanResult.llmAnalysis.findings.length > 0 ? (
              <div className='space-y-1.5'>
                {scanResult.llmAnalysis.findings.map((finding, i) => (
                  <div key={i} className='rounded border-primary/30 border-l-2 pl-3 text-sm'>
                    <p className='font-medium'>{finding.description}</p>
                    <p className='text-muted-foreground text-xs'>{finding.mitigation}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <p className='mt-2 text-muted-foreground text-xs'>建议：{scanResult.llmAnalysis.recommendation}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SecurityFlagRow({ flag }: { flag: SecurityFlag }) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='flex items-center gap-2'>
        <span
          className={`rounded px-1.5 py-0.5 font-medium text-xs ${SEVERITY_BADGE[flag.severity] ?? SEVERITY_BADGE.low}`}
        >
          {flag.severity}
        </span>
        <code className='font-mono font-semibold text-xs'>{flag.name}</code>
      </div>
      <p className='mt-1 text-muted-foreground text-sm'>{flag.description}</p>
      {flag.file ? (
        <div className='mt-2 rounded bg-muted/40 p-2 font-mono text-xs'>
          <span className='text-muted-foreground'>
            {flag.file}:{flag.line}{' '}
          </span>
          <span className='text-foreground'>{flag.snippet}</span>
        </div>
      ) : null}
    </div>
  )
}
