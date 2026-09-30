'use client'

import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { Bot, ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CopyPrompt } from '@/components/copy-prompt'
import { HighlightedCode } from '@/components/shared/highlighted-code'
import { LocaleLink } from '@/i18n/navigation'
import {
  type AssetKind,
  buildInstallPrompt,
  buildMcpConfigPreview,
  buildStoreMcpConfigPreview,
  configSnippetLang,
  type InstallAssetRef,
  RUNTIME_IDS,
  RUNTIME_LABELS,
  type RuntimeId,
} from '@/lib/agent-install'
import { Routes } from '@/lib/routes'
import { cn } from '@/lib/utils/index'
import { PromptMarkdown } from './prompt-markdown'

export interface InstallIntoAgentProps {
  kind: AssetKind
  asset: InstallAssetRef
  locale?: 'zh' | 'en'
  /** Bootstrap 「先装商店」mode (used on /start) */
  bootstrap?: boolean
  /** Include Store MCP registration snippet (enable after P1) */
  includeStoreMcp?: boolean
  /**
   * Site origin resolved on the server. Required for SSR/CSR parity: resolving it in
   * the browser (env PORT is not bundled) yields a different URL and breaks hydration.
   */
  origin?: string
  className?: string
  compact?: boolean
}

export function InstallIntoAgent({
  kind,
  asset,
  locale = 'zh',
  bootstrap = false,
  includeStoreMcp = true,
  origin,
  className,
  compact = false,
}: InstallIntoAgentProps) {
  const [runtime, setRuntime] = useState<RuntimeId>('cursor')

  const prompt = useMemo(
    () =>
      buildInstallPrompt({
        kind,
        asset,
        runtime,
        locale,
        bootstrap,
        includeStoreMcp,
        origin,
      }),
    [kind, asset, runtime, locale, bootstrap, includeStoreMcp, origin]
  )

  const jsonPreview = useMemo(() => {
    if (bootstrap && includeStoreMcp) return buildStoreMcpConfigPreview(runtime, origin)
    if (kind === 'mcp' && !bootstrap) return buildMcpConfigPreview({ asset, runtime, origin })
    return null
  }, [kind, asset, runtime, bootstrap, includeStoreMcp, origin])

  const storePreview = useMemo(() => {
    if (!includeStoreMcp || bootstrap) return null
    return buildStoreMcpConfigPreview(runtime, origin)
  }, [includeStoreMcp, bootstrap, runtime, origin])

  const title = bootstrap
    ? locale === 'zh'
      ? '先装商店 · 复制接入提示词'
      : 'Bootstrap store · copy prompt'
    : locale === 'zh'
      ? '装进 Agent'
      : 'Install into Agent'

  const hint = bootstrap
    ? locale === 'zh'
      ? '选择 Runtime，复制提示词粘贴到你的 Agent，再去浏览免费 Skill。'
      : 'Pick a runtime, paste the prompt into your Agent, then browse a free Skill.'
    : locale === 'zh'
      ? '选择 Runtime，复制安装提示词到 Cursor / Claude Code / Codex 等。'
      : 'Pick a runtime and copy the install prompt into your Agent.'

  return (
    <div className={cn('rounded-lg border border-border bg-card shadow-sm', compact ? 'p-4' : 'p-5', className)}>
      <div className='mb-3 flex items-start gap-2'>
        <Bot className='mt-0.5 h-5 w-5 shrink-0 text-primary' />
        <div className='min-w-0'>
          <h3 className='font-medium text-foreground text-sm sm:text-base'>{title}</h3>
          <p className='mt-1 text-muted-foreground text-xs leading-relaxed sm:text-sm'>{hint}</p>
        </div>
      </div>

      <Tabs value={runtime} onValueChange={(v) => setRuntime(v as RuntimeId)} className='mb-3'>
        <TabsList className='flex h-auto w-full flex-wrap justify-start gap-1'>
          {RUNTIME_IDS.map((id) => (
            <TabsTrigger key={id} value={id} className='px-2.5 text-xs sm:text-sm'>
              {RUNTIME_LABELS[id][locale]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className='mb-3 max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-3'>
        <PromptMarkdown content={prompt} />
      </div>

      {jsonPreview && kind === 'mcp' && !bootstrap ? (
        <div className='mb-3'>
          <p className='mb-1.5 font-medium text-muted-foreground text-xs'>
            {locale === 'zh' ? 'MCP 配置预览（平台网关）' : 'MCP config preview (gateway)'}
          </p>
          <HighlightedCode
            code={jsonPreview}
            lang={configSnippetLang(runtime)}
            className='max-h-36 overflow-auto border-dashed bg-background'
          />
        </div>
      ) : null}

      {storePreview ? (
        <div className='mb-3'>
          <p className='mb-1.5 font-medium text-muted-foreground text-xs'>
            {locale === 'zh' ? '添加 OpenMCP Store MCP' : 'Add OpenMCP Store MCP'}
          </p>
          <HighlightedCode
            code={storePreview}
            lang={configSnippetLang(runtime)}
            className='max-h-36 overflow-auto border-primary/30 border-dashed bg-background'
          />
        </div>
      ) : null}

      <div className='flex flex-wrap items-center gap-2'>
        <CopyPrompt
          text={prompt}
          label={locale === 'zh' ? '复制提示词' : 'Copy prompt'}
          className='bg-foreground text-background hover:bg-primary'
        />
        <LocaleLink
          href={Routes.Start}
          className='inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-4 hover:text-primary hover:underline'
        >
          {locale === 'zh' ? '起步指南 /start' : 'Getting started /start'}
          <ExternalLink className='h-3 w-3' />
        </LocaleLink>
      </div>

      <p className='mt-3 text-[11px] text-muted-foreground leading-relaxed'>
        {locale === 'zh'
          ? 'MCP / A2A 仅通过平台网关安装，不支持创作者直连。API Key 在控制台「API 密钥」创建。'
          : 'MCP / A2A install via platform gateway only — no Provider direct connect. Create an API key in the dashboard.'}
      </p>
    </div>
  )
}
