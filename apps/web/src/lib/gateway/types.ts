export type GatewayAuthUi = 'none' | 'bearer' | 'api_key' | 'basic' | 'oauth_client' | 'platform_oauth' | 'custom'
export type McpTransportUi = 'streamable' | 'sse'
export type A2aProtocolUi = '0.3' | '1.0'

export type GradedStepKey = 'handshake' | 'auth' | 'tools' | 'protocol'
export type GradedStepStatus = 'pending' | 'running' | 'pass' | 'fail'

export interface GradedTestStep {
  key: GradedStepKey
  label: string
  status: GradedStepStatus
  detail?: string
}

export interface GradedTestResult {
  steps: GradedTestStep[]
  ok: boolean
  toolCount?: number
  toolNames?: string[]
  durationMs: number
  protocol?: string
  name?: string
  description?: string
  agentCard?: Record<string, unknown>
}

export interface AutoDiscoverResult {
  ok: boolean
  name?: string
  description?: string
  protocol?: string
  auth?: GatewayAuthUi
  toolCount?: number
  toolNames?: string[]
  agentCard?: Record<string, unknown>
  durationMs: number
}

export interface AuthConfigInput {
  type: GatewayAuthUi
  secret?: string | null
  headerName?: string | null
  username?: string | null
  clientId?: string | null
  clientSecret?: string | null
  tokenUrl?: string | null
  authorizationUrl?: string | null
  scopes?: string[] | null
}

export function authHeaders(auth: AuthConfigInput): Record<string, string> {
  const headers: Record<string, string> = {}
  const secret = auth.secret?.trim()
  switch (auth.type) {
    case 'bearer':
      if (secret) headers.Authorization = `Bearer ${secret}`
      break
    case 'api_key':
      if (secret) headers[auth.headerName || 'X-API-Key'] = secret
      break
    case 'basic':
      if (secret) headers.Authorization = `Basic ${secret}`
      break
    case 'custom':
      if (secret) headers.Authorization = secret
      break
    default:
      break
  }
  return headers
}

export function toLiteLLMAuthType(auth: GatewayAuthUi): string {
  switch (auth) {
    case 'bearer':
      return 'bearer_token'
    case 'api_key':
      return 'api_key'
    case 'basic':
      return 'basic'
    case 'oauth_client':
      return 'oauth2'
    case 'platform_oauth':
      return 'oauth2'
    case 'custom':
      return 'authorization'
    default:
      return 'none'
  }
}

export function toLiteLLMTransport(transport: McpTransportUi): 'http' | 'sse' {
  return transport === 'sse' ? 'sse' : 'http'
}

export function fromDbTransport(transport: 'http' | 'sse' | 'stdio' | null | undefined): string {
  if (transport === 'sse') return 'sse'
  if (transport === 'stdio') return 'stdio'
  return 'streamable'
}

export function fromDbAuth(auth: string | null | undefined): GatewayAuthUi {
  if (auth === 'bearer' || auth === 'api_key' || auth === 'basic' || auth === 'custom') return auth
  if (auth === 'oauth2') return 'oauth_client'
  if (auth === 'platform_oauth') return 'platform_oauth'
  return 'none'
}

export function toDbAuth(auth: GatewayAuthUi): 'none' | 'bearer' | 'api_key' | 'basic' | 'oauth2' | 'platform_oauth' | 'custom' {
  if (auth === 'oauth_client') return 'oauth2'
  if (auth === 'platform_oauth') return 'platform_oauth'
  return auth
}

const FETCH_TIMEOUT_MS = 12_000

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' })
  } finally {
    clearTimeout(timer)
  }
}

export function failAt(
  steps: GradedTestStep[],
  key: GradedStepKey,
  detail: string,
  startedAt: number
): GradedTestResult {
  const result: GradedTestStep[] = steps.map((step) => {
    if (step.key === key) return { ...step, status: 'fail', detail }
    const order: GradedStepKey[] = ['handshake', 'auth', 'tools', 'protocol']
    if (order.indexOf(step.key) < order.indexOf(key)) return { ...step, status: 'pass' }
    return step
  })
  return { steps: result, ok: false, durationMs: Date.now() - startedAt }
}

export function passAll(steps: GradedTestStep[], extra: Omit<GradedTestResult, 'steps' | 'ok'>): GradedTestResult {
  return {
    ...extra,
    steps: steps.map((step) => ({ ...step, status: 'pass' })),
    ok: true,
  }
}
