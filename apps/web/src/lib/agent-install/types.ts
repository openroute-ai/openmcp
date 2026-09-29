export type AssetKind = 'skill' | 'mcp' | 'a2a'

export type RuntimeId = 'cursor' | 'claude-code' | 'codex' | 'generic-prompt'

export type InstallLocale = 'zh' | 'en'

export interface InstallAssetRef {
  id: string
  name: string
  slug: string
  priceType?: 'free' | 'paid'
  /** LiteLLM / platform gateway server_name for MCP */
  serverName?: string | null
  /** LiteLLM / platform gateway agent_name for A2A */
  agentName?: string | null
  /** Public detail path, e.g. /skills/foo */
  detailPath?: string
}

export interface BuildInstallPromptInput {
  kind: AssetKind
  asset: InstallAssetRef
  runtime: RuntimeId
  locale?: InstallLocale
  /** When true, generate 「先装商店」bootstrap rather than a single asset */
  bootstrap?: boolean
  /** Include OpenMCP Store MCP registration snippet (P1) */
  includeStoreMcp?: boolean
  /**
   * Public site origin (e.g. `https://www.openmcp.cn`).
   * Client components must receive it from the server: `process.env.PORT` is not
   * available in the browser bundle, so resolving it locally would drift from the
   * SSR output and break hydration.
   */
  origin?: string
}

export const RUNTIME_LABELS: Record<RuntimeId, { zh: string; en: string }> = {
  cursor: { zh: 'Cursor', en: 'Cursor' },
  'claude-code': { zh: 'Claude Code', en: 'Claude Code' },
  codex: { zh: 'Codex', en: 'Codex' },
  'generic-prompt': { zh: '通用提示词', en: 'Generic prompt' },
}

export const RUNTIME_IDS: RuntimeId[] = ['cursor', 'claude-code', 'codex', 'generic-prompt']
