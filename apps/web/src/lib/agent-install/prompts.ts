import type { AssetKind, BuildInstallPromptInput, InstallLocale, RuntimeId } from './types'
import {
  API_KEY_PLACEHOLDER,
  API_KEYS_PATH,
  buildA2aAgentCardUrl,
  buildA2aGatewayUrl,
  buildAssetDetailUrl,
  buildMcpGatewayUrl,
  buildStoreMcpUrl,
  GATEWAY_KEY_HEADER,
  getAppBaseUrl,
} from './urls'

function skillDir(runtime: RuntimeId): string {
  switch (runtime) {
    case 'cursor':
      return '.cursor/skills/'
    case 'claude-code':
      return '.claude/skills/ 或项目内 skills/'
    case 'codex':
      return '.codex/skills/'
    default:
      return '（按你的 Agent 文档放置 skills 目录）'
  }
}

function skillDirEn(runtime: RuntimeId): string {
  switch (runtime) {
    case 'cursor':
      return '.cursor/skills/'
    case 'claude-code':
      return '.claude/skills/ or project skills/'
    case 'codex':
      return '.codex/skills/'
    default:
      return '(follow your Agent docs for the skills directory)'
  }
}

/** mcp.json snippet — platform gateway only */
export function buildMcpJsonSnippet(opts: {
  label: string
  url: string
  runtime: RuntimeId
  headerName?: string
  /** 首行注释：网关片段与 Store MCP 片段的来源不同，不能共用一句 */
  comment?: string
}): string {
  const { label, url, runtime } = opts
  const comment = opts.comment ?? '平台网关，勿用创作者直连'
  // 网关（LiteLLM）首选 x-litellm-api-key；OpenMCP 自有端点用 Authorization
  const headerName = opts.headerName ?? 'Authorization'
  const headerValue =
    headerName === 'Authorization'
      ? `Bearer ${API_KEY_PLACEHOLDER}`
      : `${API_KEY_PLACEHOLDER}`
  if (runtime === 'claude-code') {
    return `# Claude Code CLI（${comment}）
claude mcp add --transport http ${label} ${url} \\
  --header "${headerName}: ${headerValue}"`
  }
  if (runtime === 'codex') {
    return `# Codex / 兼容客户端：将以下写入 MCP 配置（${comment}）
{
  "mcpServers": {
    "${label}": {
      "url": "${url}",
      "headers": {
        "${headerName}": "${headerValue}"
      }
    }
  }
}`
  }
  // cursor + generic
  return `{
  "mcpServers": {
    "${label}": {
      "url": "${url}",
      "headers": {
        "${headerName}": "${headerValue}"
      }
    }
  }
}`
}

/** Config snippet language: shell one-liner for Claude Code CLI, JSON elsewhere. */
export function configSnippetLang(runtime: RuntimeId): 'bash' | 'json' | 'jsonc' {
  if (runtime === 'claude-code') return 'bash'
  return runtime === 'codex' ? 'jsonc' : 'json'
}

/** Wrap a raw config snippet in a fenced code block so markdown renders it highlighted. */
function fence(lang: string, code: string): string {
  return [`\`\`\`${lang}`, code, '```'].join('\n')
}

export function buildStoreMcpSnippet(runtime: RuntimeId, locale: InstallLocale = 'zh', origin?: string): string {
  const base = getAppBaseUrl(origin)
  const url = buildStoreMcpUrl(base)
  const json = buildMcpJsonSnippet({ label: 'openmcp-store', url, runtime })
  if (locale === 'en') {
    return [
      '## Add OpenMCP Store MCP (platform-hosted)',
      `URL: ${url}`,
      `Get an API key at ${base}${API_KEYS_PATH} and replace ${API_KEY_PLACEHOLDER}. The same key also works on the platform gateway.`,
      'Do NOT point at Provider endpoints.',
      '',
      fence(configSnippetLang(runtime), json),
    ].join('\n')
  }
  return [
    '## 添加 OpenMCP Store MCP（平台托管）',
    `URL：${url}`,
    `到 ${base}${API_KEYS_PATH} 创建 API Key，将 ${API_KEY_PLACEHOLDER} 替换为真实密钥（同一把 Key 也可用于平台网关）。`,
    '禁止填写创作者直连 endpoint。',
    '',
    fence(configSnippetLang(runtime), json),
  ].join('\n')
}

function mcpGatewayForAsset(serverName: string | null | undefined, slug: string): string {
  const name = (serverName && serverName.trim()) || slug.replace(/\//g, '__')
  return buildMcpGatewayUrl(name)
}

function a2aNames(agentName: string | null | undefined, slug: string) {
  const name = (agentName && agentName.trim()) || slug.replace(/\//g, '__')
  return {
    agentName: name,
    gatewayUrl: buildA2aGatewayUrl(name),
    cardUrl: buildA2aAgentCardUrl(name),
  }
}

function buildSkillPrompt(input: BuildInstallPromptInput): string {
  const { asset, runtime, locale = 'zh', origin } = input
  const detail = buildAssetDetailUrl('skill', asset.slug, origin)
  const paid = asset.priceType === 'paid'
  const dir = locale === 'zh' ? skillDir(runtime) : skillDirEn(runtime)

  if (locale === 'en') {
    return [
      `# Install OpenMCP Hub Skill into Agent (${runtime})`,
      '',
      `Skill: ${asset.name} (\`${asset.slug}\`)`,
      `Detail: ${detail}`,
      paid
        ? 'Pricing: paid — sign in on OpenMCP Hub, purchase/unlock, then acquire before installing.'
        : 'Pricing: free — sign in and click Acquire on the detail page (or use Store MCP install_asset).',
      '',
      '## Steps',
      `1. Open ${detail} in a browser (or call Store MCP get_asset / install_asset).`,
      '2. Acquire the skill (download ZIP / clone GitHub / copy files).',
      `3. Place skill files into: ${dir}`,
      '4. Restart the Agent session / reload skills.',
      '5. Verify: ask the Agent to list available skills and confirm this skill appears.',
      '',
      'Never install from untrusted mirrors. Prefer official OpenMCP Hub URLs only.',
      input.includeStoreMcp ? `\n${buildStoreMcpSnippet(runtime, 'en', origin)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    `# 将 OpenMCP Hub Skill 装进 Agent（${runtime}）`,
    '',
    `技能：${asset.name}（\`${asset.slug}\`）`,
    `详情页：${detail}`,
    paid
      ? '定价：付费 — 请先登录 OpenMCP Hub 购买/解锁，再获取文件。'
      : '定价：免费 — 登录后在详情页点击「免费获取」（或通过 Store MCP 的 install_asset）。',
    '',
    '## 步骤',
    `1. 打开 ${detail}（或调用 Store MCP 的 get_asset / install_asset）。`,
    '2. 获取技能（下载 ZIP / 克隆 GitHub / 复制文件列表）。',
    `3. 将技能文件放到：${dir}`,
    '4. 重启 Agent 会话或重新加载 skills。',
    '5. 校验：让 Agent 列出已安装 skills，确认本技能出现。',
    '',
    '请只使用 OpenMCP Hub 官方链接，勿从不明镜像安装。',
    input.includeStoreMcp ? `\n${buildStoreMcpSnippet(runtime, 'zh', origin)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildMcpPrompt(input: BuildInstallPromptInput): string {
  const { asset, runtime, locale = 'zh', origin } = input
  const base = getAppBaseUrl(origin)
  const detail = buildAssetDetailUrl('mcp', asset.slug, origin)
  const gatewayUrl = mcpGatewayForAsset(asset.serverName, asset.slug)
  const label = (asset.serverName || asset.slug).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'openmcp-mcp'
  const snippet = buildMcpJsonSnippet({ label, url: gatewayUrl, runtime, headerName: GATEWAY_KEY_HEADER })

  if (locale === 'en') {
    return [
      `# Install OpenMCP Hub MCP via platform gateway (${runtime})`,
      '',
      `Server: ${asset.name} (\`${asset.slug}\`)`,
      `Detail: ${detail}`,
      `Gateway URL (only): ${gatewayUrl}`,
      `API key: create at ${base}${API_KEYS_PATH} → replace ${API_KEY_PLACEHOLDER}`,
      `Auth header: ${GATEWAY_KEY_HEADER}: ${API_KEY_PLACEHOLDER} (Authorization: Bearer also works)`,
      '',
      '## Important',
      '- Use the platform gateway URL only. Do NOT use Provider direct endpoints.',
      '',
      '## Config snippet',
      fence(configSnippetLang(runtime), snippet),
      '',
      '## Verify',
      '1. Save MCP config and reload MCP tools in your Agent.',
      '2. Call tools/list (or IDE MCP panel) and confirm tools appear.',
      input.includeStoreMcp ? `\n${buildStoreMcpSnippet(runtime, 'en', origin)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    `# 通过平台网关安装 OpenMCP Hub MCP（${runtime}）`,
    '',
    `服务：${asset.name}（\`${asset.slug}\`）`,
    `详情页：${detail}`,
    `网关 URL（唯一入口）：${gatewayUrl}`,
    `API Key：到 ${base}${API_KEYS_PATH} 创建，替换 ${API_KEY_PLACEHOLDER}`,
    `鉴权头：${GATEWAY_KEY_HEADER}: ${API_KEY_PLACEHOLDER}（也可用 Authorization: Bearer）`,
    '',
    '## 重要',
    '- 只使用平台网关 URL，禁止填写创作者直连 endpoint。',
    '',
    '## 配置片段',
    fence(configSnippetLang(runtime), snippet),
    '',
    '## 校验',
    '1. 保存 MCP 配置并在 Agent 中重新加载 MCP 工具。',
    '2. 执行 tools/list（或 IDE MCP 面板）确认工具列表出现。',
    input.includeStoreMcp ? `\n${buildStoreMcpSnippet(runtime, 'zh', origin)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildA2aPrompt(input: BuildInstallPromptInput): string {
  const { asset, runtime, locale = 'zh', origin } = input
  const base = getAppBaseUrl(origin)
  const detail = buildAssetDetailUrl('a2a', asset.slug, origin)
  const { agentName, gatewayUrl, cardUrl } = a2aNames(asset.agentName, asset.slug)

  if (locale === 'en') {
    return [
      `# Connect OpenMCP Hub A2A agent via platform gateway (${runtime})`,
      '',
      `Agent: ${asset.name} (\`${asset.slug}\`)`,
      `Detail: ${detail}`,
      `Gateway agent: ${agentName}`,
      `Gateway base: ${gatewayUrl}`,
      `Agent Card (via gateway): ${cardUrl}`,
      `Auth header: ${GATEWAY_KEY_HEADER}: ${API_KEY_PLACEHOLDER} (Authorization: Bearer also works)`,
      `API key: ${base}${API_KEYS_PATH}`,
      '',
      '## Important',
      '- Platform gateway only — do NOT call Provider endpoints directly.',
      '',
      '## Steps',
      '1. Fetch Agent Card from the gateway card URL with your API key.',
      '2. Configure your A2A client to use the gateway base + Bearer token.',
      '3. Send a test message and confirm a successful response.',
      input.includeStoreMcp ? `\n${buildStoreMcpSnippet(runtime, 'en', origin)}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    `# 通过平台网关接入 OpenMCP Hub A2A（${runtime}）`,
    '',
    `智能体：${asset.name}（\`${asset.slug}\`）`,
    `详情页：${detail}`,
    `网关标识：${agentName}`,
    `网关 base：${gatewayUrl}`,
    `Agent Card（经网关）：${cardUrl}`,
    `鉴权头：${GATEWAY_KEY_HEADER}: ${API_KEY_PLACEHOLDER}（也可用 Authorization: Bearer）`,
    `API Key：${base}${API_KEYS_PATH}`,
    '',
    '## 重要',
    '- 仅使用平台网关，禁止直连创作者 endpoint。',
    '',
    '## 步骤',
    '1. 用 API Key 从网关 Card URL 拉取 Agent Card。',
    '2. 在 A2A 客户端配置网关 base + Bearer Token。',
    '3. 发送测试消息，确认返回成功。',
    input.includeStoreMcp ? `\n${buildStoreMcpSnippet(runtime, 'zh', origin)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildBootstrapPrompt(
  runtime: RuntimeId,
  locale: InstallLocale,
  includeStoreMcp: boolean,
  origin?: string
): string {
  const base = getAppBaseUrl(origin)
  if (locale === 'en') {
    return [
      `# Bootstrap OpenMCP Hub marketplace into your Agent (${runtime})`,
      '',
      '## Steps',
      `1. Open ${base}/start and keep this prompt.`,
      includeStoreMcp
        ? '2. Add OpenMCP Store MCP (snippet below) with your API key from Dashboard → API Keys.'
        : '2. (Optional later) Add OpenMCP Store MCP when available.',
      `3. Browse free Skills at ${base}/skills — open one, copy “Install into Agent”, paste here.`,
      `4. Optionally connect MCP (${base}/mcp) and A2A (${base}/a2a) via platform gateway only.`,
      '',
      includeStoreMcp ? buildStoreMcpSnippet(runtime, 'en', origin) : '',
      '',
      `Provider onboarding (optional): ${base}/provider/onboarding`,
    ]
      .filter((l) => l !== undefined)
      .join('\n')
      .trim()
  }

  return [
    `# 把 OpenMCP 商店装进你的 Agent（${runtime}）`,
    '',
    '## 步骤',
    `1. 打开 ${base}/start，保留本提示词。`,
    includeStoreMcp
      ? '2. 按下方片段添加「OpenMCP Store MCP」，API Key 在 Dashboard → API Keys 创建。'
      : '2.（后续）添加 OpenMCP Store MCP。',
    `3. 打开 ${base}/skills，选一个免费 Skill，复制「装进 Agent」提示词并粘贴执行。`,
    `4. 按需接入 MCP（${base}/mcp）与 A2A（${base}/a2a）——仅使用平台网关 URL。`,
    '',
    includeStoreMcp ? buildStoreMcpSnippet(runtime, 'zh', origin) : '',
    '',
    `可选 · 成为创作者：${base}/provider/onboarding`,
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim()
}

/**
 * Build Chinese (default) / English instruction text for the user to paste into their Agent.
 */
export function buildInstallPrompt(input: BuildInstallPromptInput): string {
  const locale = input.locale ?? 'zh'
  const includeStoreMcp = input.includeStoreMcp ?? false

  if (input.bootstrap) {
    return buildBootstrapPrompt(input.runtime, locale, includeStoreMcp, input.origin)
  }

  switch (input.kind) {
    case 'skill':
      return buildSkillPrompt({ ...input, locale, includeStoreMcp })
    case 'mcp':
      return buildMcpPrompt({ ...input, locale, includeStoreMcp })
    case 'a2a':
      return buildA2aPrompt({ ...input, locale, includeStoreMcp })
    default: {
      const _exhaustive: never = input.kind
      return _exhaustive
    }
  }
}

/** Optional JSON preview for MCP install UX */
export function buildMcpConfigPreview(input: {
  asset: BuildInstallPromptInput['asset']
  runtime: RuntimeId
  origin?: string
}): string | null {
  const gatewayUrl = mcpGatewayForAsset(input.asset.serverName, input.asset.slug)
  const label =
    (input.asset.serverName || input.asset.slug).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'openmcp-mcp'
  return buildMcpJsonSnippet({
    label,
    url: gatewayUrl,
    runtime: input.runtime,
    headerName: GATEWAY_KEY_HEADER,
  })
}

export function buildStoreMcpConfigPreview(runtime: RuntimeId, origin?: string): string {
  return buildMcpJsonSnippet({
    label: 'openmcp-store',
    url: buildStoreMcpUrl(origin),
    runtime,
    comment: 'OpenMCP Hub 自建 Store MCP',
  })
}

export type { AssetKind, RuntimeId }
