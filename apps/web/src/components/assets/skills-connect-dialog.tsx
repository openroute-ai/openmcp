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
import {
  AlertCircle,
  CheckCircle2,
  FileArchive,
  GitBranch,
  Loader2,
  Package,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Upload,
  X,
} from 'lucide-react'
import { type DragEvent, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { ImageUploader } from '@/components/shared/image-uploader'
import { resultError } from '@/lib/gateway/input'
import { trpc } from '@/lib/trpc/client'
import {
  type ScanResult,
  type SecurityFlag,
  type SecurityGrade,
  type SkillAsset,
  TRUST_TIER_LABELS,
} from './assets-data'

type SubmitMode = 'github' | 'zip'
type WizardStep = 1 | 2 | 3

interface ParsedSkillInfo {
  name: string
  description: string
  version: string
  category: string
  license: string
}

interface PublishConfig {
  name: string
  description: string
  category: string
  scope: 'public' | 'private' | 'team'
  priceType: 'free' | 'paid'
  billing: string
  amount: string
  unitPrice: string
  imageUrl: string
}

const CATEGORIES = ['电商服务', '数据分析', '客户服务', '开发者工具', '办公效率', '采集', '翻译', '财务', '其他']

const defaultPublish: PublishConfig = {
  name: '',
  description: '',
  category: '',
  scope: 'public',
  priceType: 'free',
  billing: '',
  amount: '',
  unitPrice: '',
  imageUrl: '',
}

interface SkillsConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (asset: SkillAsset) => void
}

export function SkillsConnectDialog({ open, onOpenChange, onCreated }: SkillsConnectDialogProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [mode, setMode] = useState<SubmitMode>('github')
  const [githubUrl, setGithubUrl] = useState('')
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [parsedInfo, setParsedInfo] = useState<ParsedSkillInfo | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [publish, setPublish] = useState<PublishConfig>(defaultPublish)
  const [createdAsset, setCreatedAsset] = useState<SkillAsset | null>(null)
  const utils = trpc.useUtils()
  const registerWithConsole = trpc.skills.registerWithConsole.useMutation()
  const connectGithub = trpc.skills.connectFromGithub.useMutation()
  const publishSkill = trpc.skills.publish.useMutation()

  const resetState = useCallback(() => {
    setStep(1)
    setMode('github')
    setGithubUrl('')
    setZipFile(null)
    setFetching(false)
    setFetchError('')
    setParsedInfo(null)
    setScanResult(null)
    setScanning(false)
    setPublish(defaultPublish)
    setCreatedAsset(null)
  }, [])

  const handleOpenChange = (value: boolean) => {
    if (!value) resetState()
    onOpenChange(value)
  }

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file && (file.name.endsWith('.zip') || file.type === 'application/zip')) {
      setZipFile(file)
      setFetchError('')
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setZipFile(file)
      setFetchError('')
    }
  }, [])

  // GitHub 路径：向 console 登记仓库 + 轮询技能文档就绪
  const handleGithubFetch = async () => {
    setFetchError('')
    setParsedInfo(null)
    setScanResult(null)

    const match = githubUrl.match(/github\.com\/([^/]+)\/([^/\s#?]+)/)
    if (!match) {
      setFetchError('请输入有效的 GitHub 仓库地址，例如 https://github.com/owner/repo')
      return
    }

    setFetching(true)

    // console 拥有 GitHub 凭证，登记后由它的同步任务接管，并把技能文档回推。
    // 仓库尚未被索引时无法登记，这里直接给出结论，不再进入只会超时的轮询。
    const registerResult = await registerWithConsole.mutateAsync({ repoUrl: githubUrl })
    if (!registerResult.success) {
      setFetching(false)
      setFetchError(resultError(registerResult) || '仓库同步失败')
      return
    }

    const [, , repo] = match
    const repoName = repo?.replace(/\.git$/, '') ?? ''
    const fallbackInfo = (): ParsedSkillInfo => ({
      name: repoName,
      description: `${repoName} - OpenClaw Skill repository`,
      version: '1.0.0',
      category: '',
      license: 'MIT',
    })

    // 只登记模式（CONSOLE_SKILLS_REGISTER_ONLY）：console 只记录仓库归属，
    // 不建 project、不推技能文档，所以没有东西会到达这里。轮询 12 次必然
    // 超时，且超时文案会把一次成功的登记报成失败——直接用仓库名继续。
    if (registerResult.data.mode === 'register') {
      setFetching(false)
      setParsedInfo(fallbackInfo())
      toast.success('仓库已登记到 console（未发布项目）')
      return
    }

    if (!registerResult.data.ready) {
      setFetching(false)
      setFetchError(registerResult.data.message)
      return
    }

    const maxPolls = 12
    let synced = false
    let lastSkill: { title?: string | null; description?: string | null; version?: string | null } | null = null
    for (let i = 0; i < maxPolls; i++) {
      const pollResult = await utils.skills.pollSync.fetch({ repoUrl: githubUrl })
      if (pollResult.success && pollResult.data?.ready) {
        synced = true
        lastSkill = pollResult.data.skill
        break
      }
      await new Promise((r) => setTimeout(r, 5000))
    }

    setFetching(false)

    if (!synced) {
      setFetchError('GitHub 数据抓取超时，请稍后重试')
      return
    }

    setParsedInfo({
      name: lastSkill?.title || repoName,
      description: lastSkill?.description || `${repoName} - OpenClaw Skill repository`,
      version: lastSkill?.version || '1.0.0',
      category: '',
      license: 'MIT',
    })
    toast.success(registerResult.data.registered ? '仓库已同步，GitHub 数据抓取成功' : 'GitHub 数据抓取成功')
  }

  // ZIP 路径：仅预解析 skill.yaml（不落库），创建与安全扫描放在第 3 步
  const handleZipParse = async () => {
    if (!zipFile) return
    setFetching(true)
    setFetchError('')
    setScanResult(null)
    setCreatedAsset(null)

    const form = new FormData()
    form.append('file', zipFile)
    try {
      const res = await fetch('/api/skills/parse-zip', { method: 'POST', body: form })
      const json = (await res.json()) as {
        success: boolean
        error?: string
        data?: { name: string; description: string | null; version: string | null; license: string | null }
      }
      if (!json.success || !json.data) {
        setFetchError(json.error || 'ZIP 包解析失败')
        return
      }
      setParsedInfo({
        name: json.data.name,
        description: json.data.description || `${json.data.name} - OpenClaw Skill package`,
        version: json.data.version || '1.0.0',
        category: '',
        license: json.data.license || '',
      })
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : 'ZIP 包解析失败')
    } finally {
      setFetching(false)
    }
  }

  // 第 3 步：创建资产（GitHub 连接 / ZIP 上传），触发安全扫描
  const handleScan = async () => {
    if (!parsedInfo) return
    setScanning(true)
    setScanResult(null)
    try {
      if (createdAsset?.scanResult) {
        setScanResult(createdAsset.scanResult)
        return
      }
      if (mode === 'github') {
        const result = await connectGithub.mutateAsync({
          repoUrl: githubUrl,
          name: publish.name || parsedInfo.name,
          description: publish.description || parsedInfo.description,
          scope: publish.scope,
          priceType: publish.priceType,
          billingModel: (publish.billing || null) as 'one_time' | 'subscription' | 'pay_per_call' | null,
          priceAmount: publish.amount || null,
          unitPrice: publish.unitPrice || null,
          imageUrl: publish.imageUrl || null,
        })
        if (!result.success || !result.data) throw new Error(resultError(result) || '扫描失败')
        setCreatedAsset(result.data)
        setScanResult(result.data.scanResult ?? null)
        onCreated(result.data)
      } else if (zipFile) {
        const form = new FormData()
        form.append('file', zipFile)
        form.append('name', publish.name || parsedInfo.name)
        form.append('description', publish.description || parsedInfo.description)
        form.append('scope', publish.scope)
        form.append('priceType', publish.priceType)
        if (publish.billing) form.append('billingModel', publish.billing)
        if (publish.amount) form.append('priceAmount', publish.amount)
        if (publish.unitPrice) form.append('unitPrice', publish.unitPrice)
        if (publish.imageUrl) form.append('imageUrl', publish.imageUrl)
        const res = await fetch('/api/skills/upload-zip', { method: 'POST', body: form })
        const json = (await res.json()) as { success: boolean; error?: string; data?: SkillAsset }
        if (!json.success || !json.data) throw new Error(json.error || 'ZIP 上传并扫描失败')
        setCreatedAsset(json.data)
        setScanResult(json.data.scanResult ?? null)
        onCreated(json.data)
      } else {
        throw new Error('请先上传 ZIP')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '安全扫描失败')
    } finally {
      setScanning(false)
    }
  }

  const handleSave = async () => {
    if (!scanResult) return
    const canPublish = scanResult.grade === 'safe' || scanResult.grade === 'caution'
    if (!canPublish || !createdAsset) return
    try {
      const result = await publishSkill.mutateAsync({
        id: createdAsset.id,
        description: publish.description || parsedInfo?.description,
        scope: publish.scope,
        priceType: publish.priceType as 'free' | 'paid',
        billingModel: (publish.billing || undefined) as 'one_time' | 'subscription' | 'pay_per_call' | undefined,
        priceAmount: publish.amount || undefined,
        unitPrice: publish.unitPrice || undefined,
        imageUrl: publish.imageUrl || undefined,
      })
      if (!result.success || !result.data) throw new Error(resultError(result) || '保存失败')
      onCreated(result.data)
      toast.success('Skill 保存成功')
      handleOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  const canProceedToScan = !!parsedInfo && !!publish.name.trim()
  const canProceedToPublish = scanResult?.grade === 'safe' || scanResult?.grade === 'caution'
  const canSave = canProceedToPublish && !!publish.description.trim()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[88vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Package className='size-5 text-primary' />
            接入新 Skill
          </DialogTitle>
          <DialogDescription>
            通过 GitHub 仓库或 ZIP 包上传提交你的 Skill，平台将进行安全扫描后决定是否可上架。
          </DialogDescription>
        </DialogHeader>

        {/* 步骤指示器 */}
        <div className='flex items-center gap-2'>
          <StepPill active={step === 1} done={step > 1} label='1. 来源' />
          <div className='mx-1 h-px flex-1 bg-border' />
          <StepPill active={step === 2} done={step > 2} label='2. 上架信息' />
          <div className='mx-1 h-px flex-1 bg-border' />
          <StepPill active={step === 3} done={false} label='3. 安全扫描' />
        </div>

        {step === 1 ? (
          <Step1Source
            mode={mode}
            setMode={setMode}
            githubUrl={githubUrl}
            setGithubUrl={setGithubUrl}
            fetching={fetching}
            fetchError={fetchError}
            setFetchError={setFetchError}
            onGithubFetch={handleGithubFetch}
            zipFile={zipFile}
            setZipFile={setZipFile}
            dragActive={dragActive}
            handleDrag={handleDrag}
            handleDrop={handleDrop}
            handleFileSelect={handleFileSelect}
            onZipParse={handleZipParse}
            parsedInfo={parsedInfo}
            setParsedInfo={setParsedInfo}
          />
        ) : step === 2 ? (
          <Step2Publish publish={publish} setPublish={setPublish} parsedInfo={parsedInfo} />
        ) : (
          <Step3Scan parsedInfo={parsedInfo} scanning={scanning} scanResult={scanResult} onScan={handleScan} />
        )}

        <DialogFooter className='flex-wrap gap-2'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              if (step > 1) setStep((prev) => (prev - 1) as WizardStep)
              else handleOpenChange(false)
            }}
          >
            <X className='mr-2 size-4' />
            {step > 1 ? '上一步' : '取消'}
          </Button>

          {step === 1 ? (
            <Button type='button' onClick={() => setStep(2)} disabled={!canProceedToScan}>
              下一步：上架信息
            </Button>
          ) : step === 2 ? (
            <Button type='button' onClick={() => setStep(3)} disabled={!canProceedToScan}>
              下一步：安全扫描
            </Button>
          ) : scanResult ? (
            <Button type='button' onClick={handleSave} disabled={!canSave}>
              保存
            </Button>
          ) : (
            <Button type='button' onClick={handleScan} disabled={!parsedInfo || scanning}>
              {scanning ? (
                <>
                  <Loader2 className='mr-2 size-4 animate-spin' />
                  扫描中...
                </>
              ) : (
                '开始扫描'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Step 1: 来源选择 ──

interface Step1SourceProps {
  mode: SubmitMode
  setMode: (m: SubmitMode) => void
  githubUrl: string
  setGithubUrl: (v: string) => void
  fetching: boolean
  fetchError: string
  setFetchError: (v: string) => void
  onGithubFetch: () => void
  zipFile: File | null
  setZipFile: (f: File | null) => void
  dragActive: boolean
  handleDrag: (e: DragEvent) => void
  handleDrop: (e: DragEvent) => void
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onZipParse: () => void
  parsedInfo: ParsedSkillInfo | null
  setParsedInfo: (info: ParsedSkillInfo | null) => void
}

function Step1Source(props: Step1SourceProps) {
  return (
    <div className='space-y-5'>
      {/* 来源切换 */}
      <div className='flex rounded-xl border bg-card p-1.5'>
        <button
          type='button'
          onClick={() => props.setMode('github')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium text-sm transition-all ${
            props.mode === 'github'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <GitBranch className='size-4' />
          GitHub 仓库
        </button>
        <button
          type='button'
          onClick={() => props.setMode('zip')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium text-sm transition-all ${
            props.mode === 'zip' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Upload className='size-4' />
          ZIP 包上传
        </button>
      </div>

      {props.mode === 'github' ? (
        <div className='space-y-4'>
          <div className='rounded-xl border bg-card p-6'>
            <h3 className='mb-4 font-semibold text-base'>GitHub 仓库地址</h3>
            <p className='mb-3 text-muted-foreground text-xs'>
              平台通过 internal API 将仓库登记到 console，由其同步任务补齐 README 与技能文档，全程不跳转。数据就绪后自动进入安全扫描。
            </p>
            <div className='flex gap-3'>
              <Input
                type='url'
                placeholder='https://github.com/username/skill-name'
                value={props.githubUrl}
                onChange={(e) => {
                  props.setGithubUrl(e.target.value)
                  props.setParsedInfo(null)
                  props.setFetchError('')
                }}
                className='flex-1'
              />
              <Button type='button' onClick={props.onGithubFetch} disabled={!props.githubUrl.trim() || props.fetching}>
                {props.fetching ? (
                  <>
                    <Loader2 className='mr-2 size-4 animate-spin' />
                    抓取中...
                  </>
                ) : (
                  '抓取'
                )}
              </Button>
            </div>

            {props.fetchError ? (
              <div className='mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-destructive text-sm'>
                <AlertCircle className='size-4 shrink-0' />
                {props.fetchError}
              </div>
            ) : null}

            {props.fetching ? (
              <div className='mt-4 flex items-center gap-2 rounded-lg bg-primary/5 px-4 py-3 text-primary text-sm'>
                <Loader2 className='size-4 animate-spin' />
                正在通过 internal API 抓取 GitHub 数据...
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className='space-y-4'>
          <div className='rounded-xl border bg-card p-6'>
            <h3 className='mb-4 font-semibold text-base'>上传 ZIP 包</h3>
            <div
              onDragEnter={props.handleDrag}
              onDragLeave={props.handleDrag}
              onDragOver={props.handleDrag}
              onDrop={props.handleDrop}
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 transition-all ${
                props.dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              } ${props.zipFile ? 'border-primary/30 bg-primary/5' : ''}`}
            >
              {props.zipFile ? (
                <div className='flex flex-col items-center gap-3'>
                  <FileArchive className='size-10 text-primary' />
                  <div className='text-center'>
                    <p className='font-semibold text-sm'>{props.zipFile.name}</p>
                    <p className='mt-0.5 text-muted-foreground text-xs'>
                      {(props.zipFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <div className='flex gap-2'>
                    <Button type='button' variant='secondary' size='sm' onClick={props.onZipParse}>
                      解析
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        props.setZipFile(null)
                        props.setParsedInfo(null)
                      }}
                    >
                      <X className='mr-1 size-3' />
                      移除
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='flex flex-col items-center gap-3'>
                  <Upload className='size-10 text-muted-foreground' />
                  <div className='text-center'>
                    <p className='text-sm'>
                      拖拽 ZIP 文件到此处，或{' '}
                      <label className='cursor-pointer font-medium text-primary hover:text-primary/80'>
                        点击选择
                        <input type='file' accept='.zip' onChange={props.handleFileSelect} className='sr-only' />
                      </label>
                    </p>
                    <p className='mt-1 text-muted-foreground text-xs'>仅支持 .zip 格式，最大 50MB</p>
                  </div>
                </div>
              )}
            </div>
            {props.fetching ? (
              <div className='mt-4 flex items-center gap-2 rounded-lg bg-primary/5 px-4 py-3 text-primary text-sm'>
                <Loader2 className='size-4 animate-spin' />
                正在解压并解析 skill.yaml...
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 解析结果 */}
      {props.parsedInfo ? (
        <div className='rounded-xl border border-primary/30 bg-primary/5 p-5'>
          <div className='mb-3 flex items-center gap-2'>
            <CheckCircle2 className='size-4 text-primary' />
            <span className='font-semibold text-sm'>skill.yaml 解析成功</span>
          </div>
          <div className='grid grid-cols-2 gap-3 text-sm'>
            <div>
              <span className='text-muted-foreground'>名称：</span>
              <span className='font-mono font-semibold'>{props.parsedInfo.name}</span>
            </div>
            <div>
              <span className='text-muted-foreground'>版本：</span>
              <span>{props.parsedInfo.version}</span>
            </div>
            <div>
              <span className='text-muted-foreground'>License：</span>
              <span>{props.parsedInfo.license || '—'}</span>
            </div>
          </div>
          <p className='mt-2 text-muted-foreground text-sm'>{props.parsedInfo.description}</p>
        </div>
      ) : null}
    </div>
  )
}

// ── Step 3: 安全扫描 ──

interface Step3ScanProps {
  parsedInfo: ParsedSkillInfo | null
  scanning: boolean
  scanResult: ScanResult | null
  onScan: () => void
}

function Step3Scan({ parsedInfo, scanning, scanResult, onScan }: Step3ScanProps) {
  return (
    <div className='space-y-5'>
      <div className='rounded-xl border bg-card p-6'>
        <h3 className='mb-2 font-semibold text-base'>安全扫描</h3>
        <p className='mb-4 text-muted-foreground text-sm'>
          对 Skill 的全部文件（README + 入口脚本 + 配置文件 + 源码）进行两阶段安全扫描：
          <br />
          阶段 1 规则扫描（零成本正则匹配）→ 阶段 2 LLM 语义复核（仅 caution/unsafe 触发，DeepSeek V4）。
        </p>

        {!scanResult && !scanning ? (
          <Button type='button' onClick={onScan} disabled={!parsedInfo}>
            <ShieldCheck className='mr-2 size-4' />
            开始扫描
          </Button>
        ) : null}

        {scanning ? (
          <div className='space-y-3'>
            <div className='flex items-center gap-2 text-primary text-sm'>
              <Loader2 className='size-4 animate-spin' />
              <span>正在创建资产并扫描全部文件...</span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div className='h-full animate-pulse rounded-full bg-primary' style={{ width: '60%' }} />
            </div>
          </div>
        ) : null}

        {scanResult ? <ScanResultCard result={scanResult} /> : null}
      </div>
    </div>
  )
}

// ── 扫描结果卡片 ──

const GRADE_CONFIG: Record<SecurityGrade, { icon: typeof ShieldCheck; color: string; bg: string; label: string }> = {
  safe: {
    icon: ShieldCheck,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
    label: '扫描通过',
  },
  caution: {
    icon: ShieldAlert,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10',
    label: '扫描通过（有风险提示）',
  },
  unsafe: {
    icon: ShieldX,
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500/10',
    label: '扫描未通过，已进入人工复核',
  },
  reject: { icon: ShieldX, color: 'text-destructive', bg: 'bg-destructive/10', label: '扫描驳回' },
  unknown: { icon: AlertCircle, color: 'text-muted-foreground', bg: 'bg-muted', label: '未知' },
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
}

function ScanResultCard({ result }: { result: ScanResult }) {
  const config = GRADE_CONFIG[result.grade]
  const Icon = config.icon

  return (
    <div className='space-y-4'>
      {/* 评级总览 */}
      <div className={`flex items-center gap-3 rounded-lg p-4 ${config.bg}`}>
        <Icon className={`size-6 ${config.color}`} />
        <div>
          <p className={`font-semibold text-sm ${config.color}`}>{config.label}</p>
          <p className='text-muted-foreground text-xs'>
            信任层级：Tier {result.trustTier} ({TRUST_TIER_LABELS[result.trustTier]}) · 规则集 {result.rulesVersion} ·
            扫描 {result.fileCount} 个文件
          </p>
        </div>
      </div>

      {/* 命中 flag 列表 */}
      {result.flags.length > 0 ? (
        <div>
          <h4 className='mb-2 font-medium text-sm'>命中风险标记（{result.flags.length}）</h4>
          <div className='space-y-2'>
            {result.flags.map((flag) => (
              <FlagItem key={flag.name} flag={flag} />
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
      {result.llmAnalysis ? (
        <div className='rounded-lg border p-4'>
          <h4 className='mb-2 flex items-center gap-1.5 font-medium text-sm'>
            <ShieldCheck className='size-4 text-primary' />
            LLM 语义复核（DeepSeek V4）
          </h4>
          <p className='mb-2 text-muted-foreground text-sm'>{result.llmAnalysis.riskSummary}</p>
          <div className='mb-2 flex items-center gap-4 text-muted-foreground text-xs'>
            <span>LLM 评级：{result.llmAnalysis.grade}</span>
            <span>置信度：{(result.llmAnalysis.confidence * 100).toFixed(0)}%</span>
          </div>
          {result.llmAnalysis.findings.length > 0 ? (
            <div className='space-y-1.5'>
              {result.llmAnalysis.findings.map((finding, i) => (
                <div key={i} className='rounded border-primary/30 border-l-2 pl-3 text-sm'>
                  <p className='font-medium'>{finding.description}</p>
                  <p className='text-muted-foreground text-xs'>{finding.mitigation}</p>
                </div>
              ))}
            </div>
          ) : null}
          <p className='mt-2 text-muted-foreground text-xs'>建议：{result.llmAnalysis.recommendation}</p>
        </div>
      ) : null}
    </div>
  )
}

function FlagItem({ flag }: { flag: SecurityFlag }) {
  return (
    <div className='rounded-lg border p-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex-1'>
          <div className='flex items-center gap-2'>
            <span
              className={`rounded px-1.5 py-0.5 font-medium text-xs ${SEVERITY_COLOR[flag.severity] ?? SEVERITY_COLOR.low}`}
            >
              {flag.severity}
            </span>
            <code className='font-mono font-semibold text-xs'>{flag.name}</code>
          </div>
          <p className='mt-1 text-muted-foreground text-sm'>{flag.description}</p>
        </div>
      </div>
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

// ── Step 2: 上架信息 ──

interface Step2PublishProps {
  publish: PublishConfig
  setPublish: React.Dispatch<React.SetStateAction<PublishConfig>>
  parsedInfo: ParsedSkillInfo | null
}

function Step2Publish({ publish, setPublish, parsedInfo }: Step2PublishProps) {
  return (
    <div className='space-y-5'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-5'>
        <div className='sm:col-span-2'>
          <Label>Logo / 封面图</Label>
          <div className='mt-1.5'>
            <ImageUploader
              label='Logo / 封面图'
              value={publish.imageUrl}
              maxBytes={5 * 1024 * 1024}
              variant='square'
              onChange={(url) =>
                setPublish((prev) => ({ ...prev, imageUrl: url ?? '' }))
              }
            />
          </div>
        </div>
        <div className='space-y-4 sm:col-span-3'>
          <div className='space-y-1.5'>
            <Label>
              Skill 名称<span className='text-destructive'> *</span>
            </Label>
            <Input
              value={publish.name}
              onChange={(e) => setPublish((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={parsedInfo?.name || '输入 Skill 名称'}
            />
          </div>
          <div className='space-y-1.5'>
            <Label>
              描述<span className='text-destructive'> *</span>
            </Label>
            <Textarea
              rows={4}
              value={publish.description}
              onChange={(e) => setPublish((prev) => ({ ...prev, description: e.target.value }))}
              placeholder='描述技能的能力和用例（20-2000 字符）'
            />
          </div>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label>分类</Label>
          <Select value={publish.category} onValueChange={(v) => setPublish((prev) => ({ ...prev, category: v }))}>
            <SelectTrigger>
              <SelectValue placeholder='选择分类（可选）' />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='space-y-1.5'>
          <Label>可见范围</Label>
          <Select
            value={publish.scope}
            onValueChange={(v) => setPublish((prev) => ({ ...prev, scope: v as PublishConfig['scope'] }))}
          >
            <SelectTrigger>
              <SelectValue placeholder='-' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='public'>公开</SelectItem>
              <SelectItem value='private'>私有（仅自己）</SelectItem>
              <SelectItem value='team'>指定用户 / 密钥组</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='space-y-3 rounded-lg border p-4'>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label>价格类型</Label>
            <Select
              value={publish.priceType}
              onValueChange={(v) => setPublish((prev) => ({ ...prev, priceType: v as PublishConfig['priceType'] }))}
            >
              <SelectTrigger>
                <SelectValue placeholder='-' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='free'>免费</SelectItem>
                <SelectItem value='paid'>付费</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {publish.priceType === 'paid' ? (
            <div className='space-y-1.5'>
              <Label>计费模式</Label>
              <Select value={publish.billing} onValueChange={(v) => setPublish((prev) => ({ ...prev, billing: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder='-' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='one_time'>一次性</SelectItem>
                  <SelectItem value='subscription'>订阅（周期性）</SelectItem>
                  <SelectItem value='pay_per_call'>按次计费</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {publish.priceType === 'paid' ? (
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label>
                {publish.billing === 'pay_per_call' ? '单次调用价格（CNY）' : '价格（CNY）'}
                <span className='text-destructive'> *</span>
              </Label>
              <Input
                type='number'
                step={publish.billing === 'pay_per_call' ? '0.0001' : '0.01'}
                min='0'
                value={publish.billing === 'pay_per_call' ? publish.unitPrice : publish.amount}
                onChange={(e) =>
                  setPublish((prev) =>
                    prev.billing === 'pay_per_call'
                      ? { ...prev, unitPrice: e.target.value }
                      : { ...prev, amount: e.target.value }
                  )
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── 步骤指示器 ──

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
