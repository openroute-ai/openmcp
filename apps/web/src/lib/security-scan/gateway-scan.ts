/**
 * MCP / A2A 资产的规则扫描。
 *
 * ## 和 Skills 扫描的根本区别（不要混淆两者强度）
 *
 * Skills 是内容接入：平台拿得到 README 和源码全文，可以逐文件扫 `curl | bash`、
 * 硬编码密钥这类**实际会被执行的东西**。
 *
 * MCP / A2A 是端点接入：平台只有对方**自己声明**的元数据——端点 URL、传输方式、
 * 工具名与工具描述。对方进程里到底跑了什么，平台看不到。所以这里的扫描是
 * *元数据扫描*：它能发现"把凭据写在 URL 里""工具描述在诱导 Agent 交出密钥"
 * 这类**声明本身就自曝**的问题，但发现不了"这个工具实际会读 ~/.ssh"。
 *
 * 因此评级刻意保守：扫不出问题只给 `safe`，并且始终把 `scannedAt` 和
 * `rulesVersion` 落库，让"什么时候、按哪版规则扫的"可追溯。宁可显示
 * 「未扫描」也不要显示一个并不存在的保证。
 *
 * 阶段 2 的 LLM 语义复核沿用 Skills 的 `runLlmAnalysis`，规则集升级后重扫即可
 * 覆盖历史资产。
 */

import { analyzeWithLlm } from './llm-analyzer'
import type { SecurityGrade, SecurityFlagHit } from './types'

/** 与 Skills 的 `SCAN_RULES_VERSION` 分开计版本：规则集不同，混算无法复现。 */
export const GATEWAY_SCAN_RULES_VERSION = 'gw-v1.0.0'

export interface GatewayScanInput {
  kind: 'mcp' | 'a2a'
  /** 端点 URL */
  endpoint: string | null | undefined
  /** 传输方式（mcp: streamable/sse/http/stdio；a2a: 协议版本） */
  protocol: string | null | undefined
  /** 声明的鉴权方式 */
  auth: string | null | undefined
  name: string
  description: string | null | undefined
  /** 工具名 + 工具描述（来自 tools/list 或 Agent Card） */
  tools: Array<{ name: string; description?: string | null }>
}

export interface GatewayScanResult {
  grade: SecurityGrade
  flags: SecurityFlagHit[]
  scannedAt: Date
  rulesVersion: string
  fileCount: number
}

/**
 * 直接判 reject 的模式。
 *
 * 只收"自曝到不可能是误伤"的东西：明文密钥、管道执行、读取私钥目录。
 * 判定依据写在 pattern 的名字里，便于复核时判断是否过严。
 */
const REJECT_PATTERNS: Array<{ name: string; re: RegExp; description: string }> = [
  {
    name: 'credential_in_url',
    re: /:\/\/[^/\s:@]+:[^/\s:@]+@/,
    description: '端点 URL 内嵌了明文用户名/密码，任何读到该 URL 的人都能直接复用凭据',
  },
  {
    name: 'secret_in_query',
    re: /[?&](api[_-]?key|token|secret|password|access[_-]?token)=/i,
    description: '凭据作为查询参数出现在端点 URL 中，会被代理与访问日志记录',
  },
  {
    name: 'private_key_reference',
    re: /(\.ssh\/id_[a-z0-9]+|\.aws\/credentials|\.npmrc|\.netrc)/i,
    description: '工具声明中引用了私钥或凭据文件路径，具备读取宿主凭据的能力',
  },
  {
    name: 'pipe_to_shell',
    re: /\b(curl|wget)\b[^\n|]{0,80}\|\s*(sudo\s+)?(ba|z|k)?sh\b/i,
    description: '工具描述中出现「下载后直接交给 shell 执行」的写法',
  },
]

/** 判 unsafe 的模式：不是密钥泄漏，但足以让买家在知情后仍应犹豫。 */
const HIGH_RISK_PATTERNS: Array<{ name: string; re: RegExp; description: string }> = [
  {
    name: 'prompt_injection',
    re: /(ignore (all )?(previous|prior|above) instructions|忽略(之前|以上|前面)(的)?(所有)?(指令|提示)|disregard (the )?(system|previous) (prompt|message))/i,
    description: '工具描述中出现绕过既有指令的措辞，可能试图劫持调用方 Agent 的行为',
  },
  {
    name: 'credential_exfiltration',
    re: /(send|upload|post|forward|exfiltrate|上报|上传|发送)[^.\n]{0,40}(api[_\- ]?key|access[_\- ]?token|credential|password|env(ironment)? variable|系统提示|system prompt)/i,
    description: '工具描述暗示会把凭据或系统提示发送到外部，属于典型的数据外泄诱导',
  },
  {
    name: 'shell_execution',
    re: /(execute|run|执行)[^.\n]{0,20}(shell|bash|command|任意命令|system command)/i,
    description: '工具声明可直接执行 shell 命令，权限面远大于普通业务工具',
  },
]

/**
 * 判 caution 的模式：需要买家知情，但不构成风险结论。
 *
 * `stdin_transport` 只在 `protocol` 上匹配（端点是本地路径，不含传输方式）。
 */
const STDIO_PATTERN_SET: Array<{ name: string; re: RegExp; description: string }> = [
  {
    name: 'stdin_transport',
    re: /^stdio$/i,
    description: 'stdio 传输需要平台以子进程方式运行对方代码，权限面大于网络端点',
  },
]
const MEDIUM_RISK_PATTERNS: Array<{ name: string; re: RegExp; description: string }> = [
  {
    name: 'plaintext_endpoint',
    re: /^http:\/\//i,
    description: '端点使用明文 HTTP，流量可被中间人读取或篡改',
  },
]

/**
 * 已知官方的 host（含常见子域形式）。
 *
 * 没有公共后缀列表就无法判断"注册域"边界，所以这个名单必须覆盖厂商真实使用的
 * 各种子域——`api.githubcopilot.com` 就是 GitHub 官方的 Copilot API 端点，
 * 只放 `github.com` 会把它判成冒名。
 */
const KNOWN_OFFICIAL_HOSTS = [
  'github.com',
  'githubusercontent.com',
  'githubcopilot.com',
  'githubassets.com',
  'modelcontextprotocol.io',
  'googleapis.com',
  'google.com',
  'microsoft.com',
  'azure.com',
  'windows.net',
  'notion.so',
  'notion.site',
  'slack.com',
  'atlassian.net',
  'atlassian.com',
]

/** 声称是某官方产品、但 host 不对：典型的仿冒入口命名。 */
const OFFICIAL_IMPERSONATION: Array<{ name: string; re: RegExp; official: string }> = [
  { name: 'impersonate_github', re: /github/i, official: 'github.com' },
  { name: 'impersonate_google', re: /google/i, official: 'googleapis.com' },
  { name: 'impersonate_microsoft', re: /\b(office|outlook|microsoft)\b/i, official: 'microsoft.com' },
  { name: 'impersonate_notion', re: /notion/i, official: 'notion.so' },
  { name: 'impersonate_slack', re: /slack/i, official: 'slack.com' },
]

function hostOf(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null
  try {
    return new URL(endpoint).host.toLowerCase()
  } catch {
    return null
  }
}

/** 命中位置用于让审核者定位到具体是哪个工具/哪句话。 */
function locate(haystack: string, re: RegExp): { line: number; snippet: string } {
  const at = haystack.search(re)
  if (at < 0) return { line: 1, snippet: haystack.slice(0, 80) }
  return {
    line: haystack.slice(0, at).split('\n').length,
    snippet: haystack.slice(Math.max(0, at - 20), at + 60),
  }
}

function scanText(
  text: string,
  file: string,
  patterns: Array<{ name: string; re: RegExp; description: string }>,
  severity: SecurityFlagHit['severity']
): SecurityFlagHit[] {
  const hits: SecurityFlagHit[] = []
  for (const p of patterns) {
    // 逐条用非全局正则匹配，避免 lastIndex 残留导致漏检
    const re = new RegExp(p.re.source, p.re.flags.replace('g', ''))
    if (!re.test(text)) continue
    const at = locate(text, re)
    hits.push({
      name: p.name,
      severity,
      description: p.description,
      file,
      line: at.line,
      snippet: at.snippet,
      citedOrNegated: false,
    })
  }
  return hits
}

/** 纯规则扫描，不落库、不调 LLM，便于单测。 */
export function scanGatewayMetadata(input: GatewayScanInput): GatewayScanResult {
  const flags: SecurityFlagHit[] = []
  const endpoint = input.endpoint ?? ''
  const header = `${input.name}\n${input.description ?? ''}`
  const host = hostOf(endpoint)

  // 1) reject 级：端点 URL 自身
  flags.push(...scanText(endpoint, 'endpoint', REJECT_PATTERNS, 'critical'))

  // 2) reject/high：名称与描述
  flags.push(...scanText(header, 'metadata', REJECT_PATTERNS, 'critical'))
  flags.push(...scanText(header, 'metadata', HIGH_RISK_PATTERNS, 'high'))

  // 3) medium：明文 HTTP（看端点）与 stdio 传输（看 protocol，不是端点）
  flags.push(...scanText(endpoint, 'endpoint', MEDIUM_RISK_PATTERNS, 'medium'))
  flags.push(
    ...scanText(input.protocol ?? '', 'protocol', STDIO_PATTERN_SET, 'medium')
  )

  // 4) 逐个工具扫描
  for (const tool of input.tools) {
    const toolText = `${tool.name}\n${tool.description ?? ''}`
    flags.push(...scanText(toolText, `tool:${tool.name}`, REJECT_PATTERNS, 'critical'))
    flags.push(...scanText(toolText, `tool:${tool.name}`, HIGH_RISK_PATTERNS, 'high'))
  }

  // 5) 冒名：自称官方但 host 不在官方域名里
  if (host) {
    const official = KNOWN_OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    if (!official) {
      for (const imp of OFFICIAL_IMPERSONATION) {
        if (!imp.re.test(header)) continue
        // severity 刻意是 medium 而不是 high：没有公共后缀列表就无法可靠判断
        // 注册域边界，厂商的合法子域很容易被误判。宁可提示"请自行确认"，
        // 也不要把一个真的官方端点标成 unsafe——安全徽章一旦误报就没人信了。
        flags.push({
          name: imp.name,
          severity: 'medium',
          description: `自称与 ${imp.official} 相关，但端点 host 是 ${host}，请确认是否为仿冒入口`,
          file: 'endpoint',
          line: 1,
          snippet: endpoint,
          citedOrNegated: false,
        })
      }
    }
  }

  flags.push(...scanDeclaredAuth(input, endpoint))

  return {
    grade: gradeFrom(flags),
    flags: dedupe(flags),
    scannedAt: new Date(),
    rulesVersion: GATEWAY_SCAN_RULES_VERSION,
    fileCount: input.tools.length,
  }
}

/** 鉴权方式的固有风险：宣称走 OAuth 却不带任何凭据配置，等于裸奔。 */
function scanDeclaredAuth(
  input: GatewayScanInput,
  endpoint: string
): SecurityFlagHit[] {
  const hits: SecurityFlagHit[] = []
  const auth = (input.auth ?? '').toLowerCase()
  const free = ['none', '', 'public']
  if (!free.includes(auth)) return hits
  // 完全公开的端点若声明了需要凭据的工具，且未走 TLS，风险由买家承担
  if (input.tools.some((t) => /api[_-]?key|token|credential|secret/i.test(t.name)) && /^http:\/\//i.test(endpoint)) {
    hits.push({
      name: 'sensitive_tool_on_public_plaintext',
      severity: 'medium',
      description: '工具名暗示需要凭据，但端点无鉴权且使用明文 HTTP',
      file: 'metadata',
      line: 1,
      snippet: `${input.name} (auth=${auth || 'none'})`,
      citedOrNegated: false,
    })
  }
  return hits
}

function dedupe(flags: SecurityFlagHit[]): SecurityFlagHit[] {
  const seen = new Set<string>()
  const out: SecurityFlagHit[] = []
  for (const f of flags) {
    const key = `${f.name}|${f.file}|${f.line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

/** 评级只看命中的最高严重度，不做加权平均——避免用一堆 low 冲掉一个 critical。 */
export function gradeFrom(flags: SecurityFlagHit[]): SecurityGrade {
  if (flags.some((f) => f.severity === 'critical')) return 'reject'
  if (flags.some((f) => f.severity === 'high')) return 'unsafe'
  if (flags.some((f) => f.severity === 'medium')) return 'caution'
  if (flags.some((f) => f.severity === 'low')) return 'safe'
  return 'safe'
}

/**
 * 规则 + LLM 两阶段。
 *
 * 与 Skills 的差异：`reject` 级不会自动下架资产，只标记并交给人工审核——
 * 端点接入没有平台托管的代码可执行，"发现了危险模式"不等于"对方真的在这么干"。
 */
export async function runGatewayScan(input: GatewayScanInput): Promise<{
  result: GatewayScanResult
  llmGrade: SecurityGrade | null
  llmAnalysis: string | null
}> {
  const result = scanGatewayMetadata(input)

  if (result.grade === 'reject' || result.grade === 'unsafe') {
    try {
      const analysis = await analyzeWithLlm(
        [
          { path: 'endpoint', content: input.endpoint ?? '' },
          { path: 'metadata', content: `${input.name}\n${input.description ?? ''}` },
          ...input.tools.map((t) => ({
            path: `tool:${t.name}`,
            content: `${t.name}\n${t.description ?? ''}`,
          })),
        ],
        result.flags,
        result.grade
      )
      return {
        result,
        llmGrade: analysis?.grade ?? null,
        llmAnalysis: analysis?.riskSummary ?? null,
      }
    } catch {
      // LLM 复核失败不改变规则结论：规则已经跑完，语义复核只是补充视角。
      return { result, llmGrade: null, llmAnalysis: null }
    }
  }

  return { result, llmGrade: null, llmAnalysis: null }
}