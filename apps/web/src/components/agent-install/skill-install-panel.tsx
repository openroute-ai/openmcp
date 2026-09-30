'use client'

import { Button } from '@workspace/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { ChevronDown, Copy as CopyIcon, Download, FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PromptMarkdown } from '@/components/agent-install/prompt-markdown'
import { CopyPrompt } from '@/components/copy-prompt'
import {
  buildInstallPrompt,
  buildSkillInstallCopyPrompt,
  type InstallAssetRef,
  RUNTIME_IDS,
  RUNTIME_LABELS,
  type RuntimeId,
} from '@/lib/agent-install'
import { cn } from '@/lib/utils/index'

const TARGET_DIRS: Record<Exclude<RuntimeId, 'generic-prompt'>, string> = {
  cursor: '~/.cursor/skills/<name>/',
  'claude-code': '~/.claude/skills/<name>/',
  codex: '~/.codex/skills/<name>/',
}

export interface SkillInstallPanelProps {
  asset: InstallAssetRef
  locale?: 'zh' | 'en'
  packageUrl?: string
  /** Site origin resolved on the server — reading it in the browser breaks hydration. */
  origin?: string
  className?: string
}

export function SkillInstallPanel({ asset, locale = 'zh', packageUrl, origin, className }: SkillInstallPanelProps) {
  const [runtime, setRuntime] = useState<RuntimeId>('cursor')
  const [localOpen, setLocalOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const zipUrl = packageUrl || `/api/skills/${asset.id}/package`

  const copyPrompt = useMemo(
    () => buildSkillInstallCopyPrompt({ slug: asset.slug, origin, locale }),
    [asset.slug, origin, locale]
  )

  const legacyPrompt = useMemo(
    () =>
      buildInstallPrompt({
        kind: 'skill',
        asset,
        runtime,
        locale,
        includeStoreMcp: true,
        origin,
      }),
    [asset, runtime, locale, origin]
  )

  const targetDir =
    runtime === 'generic-prompt' ? `skills/${asset.slug}/` : TARGET_DIRS[runtime].replace('<name>', asset.slug)

  const zh = locale === 'zh'

  const handleDownloadZip = async () => {
    setDownloading(true)
    try {
      const res = await fetch(zipUrl, { credentials: 'include' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const msg =
          (body && typeof body.error === 'string' && body.error) ||
          (zh ? '下载失败，请登录或先购买' : 'Download failed — sign in or purchase first')
        toast.error(msg)
        return
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const match = /filename="?([^"]+)"?/.exec(cd)
      const filename = match?.[1] || `${asset.slug}.zip`
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast.success(zh ? '已开始下载 Zip 包' : 'Zip download started')
    } catch {
      toast.error(zh ? '下载失败' : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const copyText = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(okMsg)
    } catch {
      toast.error(zh ? '复制失败' : 'Copy failed')
    }
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card p-5 shadow-sm', className)}>
      <h3 className='mb-3 font-medium text-foreground text-sm sm:text-base'>
        {zh ? '将提示词发送给你的 AI 安装该 Skill' : 'Send this prompt to your AI to install the Skill'}
      </h3>

      <div className='mb-3 rounded-md border border-border border-dashed bg-muted/30 px-3 py-2'>
        <p className='break-all font-mono text-[12px] text-muted-foreground leading-relaxed'>{copyPrompt}</p>
      </div>

      <CopyPrompt
        text={copyPrompt}
        label={zh ? '复制 prompt' : 'Copy prompt'}
        className='mb-3 w-full justify-center bg-foreground text-background hover:bg-primary'
      />

      <div className='flex flex-col gap-2'>
        <Button
          type='button'
          variant='outline'
          className='w-full justify-center'
          disabled={downloading}
          onClick={() => void handleDownloadZip()}
        >
          <Download className='mr-2 h-4 w-4' />
          {downloading ? (zh ? '下载中…' : 'Downloading…') : zh ? '下载 Zip 包安装' : 'Download Zip to install'}
        </Button>

        <Collapsible open={localOpen} onOpenChange={setLocalOpen}>
          <CollapsibleTrigger asChild>
            <Button type='button' variant='outline' className='w-full justify-between'>
              <span className='inline-flex items-center'>
                <FolderOpen className='mr-2 h-4 w-4' />
                {zh ? '安装到本地 Agent' : 'Install to local Agent'}
              </span>
              <ChevronDown className={cn('h-4 w-4 transition', localOpen && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className='mt-2 space-y-3 rounded-md border border-border bg-muted/20 p-3'>
            <Tabs value={runtime} onValueChange={(v) => setRuntime(v as RuntimeId)}>
              <TabsList className='flex h-auto w-full flex-wrap justify-start gap-1'>
                {RUNTIME_IDS.map((id) => (
                  <TabsTrigger key={id} value={id} className='px-2.5 text-xs'>
                    {RUNTIME_LABELS[id][locale]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div>
              <p className='mb-1 text-muted-foreground text-xs'>{zh ? '目标目录' : 'Target directory'}</p>
              <div className='flex items-center gap-2'>
                <code className='flex-1 truncate rounded border bg-background px-2 py-1.5 font-mono text-[11px]'>
                  {targetDir}
                </code>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => void copyText(targetDir, zh ? '已复制路径' : 'Path copied')}
                >
                  <CopyIcon className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>
            <ol className='list-decimal space-y-1 pl-4 text-muted-foreground text-xs leading-relaxed'>
              <li>{zh ? '点击上方「下载 Zip 包安装」' : 'Download the Zip package above'}</li>
              <li>
                {zh
                  ? `解压到 ${targetDir}（目录名与 SKILL.md 中 name 一致）`
                  : `Unzip into ${targetDir} (folder name = SKILL.md name)`}
              </li>
              <li>{zh ? '重载 Agent 会话后即可调用该 Skill' : 'Reload the Agent session to use the Skill'}</li>
            </ol>
            <p className='text-[11px] text-muted-foreground'>
              {zh
                ? '包内含 SKILL.md 与说明文件，不是仅聊天提示词。'
                : 'The package includes SKILL.md and files — not just a chat prompt.'}
            </p>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
          <CollapsibleTrigger asChild>
            <Button type='button' variant='ghost' className='w-full justify-between text-muted-foreground'>
              <span>{zh ? '复制给 Agent 的说明（备用）' : 'Copy Agent instructions (fallback)'}</span>
              <ChevronDown className={cn('h-4 w-4 transition', promptOpen && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className='mt-2 space-y-2'>
            <div className='max-h-64 overflow-auto rounded-md border bg-muted/30 p-2.5'>
              <PromptMarkdown content={legacyPrompt} />
            </div>
            <CopyPrompt
              text={legacyPrompt}
              label={zh ? '复制说明' : 'Copy instructions'}
              className='bg-muted text-foreground hover:bg-muted/80'
            />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}
