import { getA2aGateway, isLiteLLMConfigured } from "@workspace/litellm"
import {
  type A2aProtocolUi,
  type AuthConfigInput,
  type AutoDiscoverResult,
  authHeaders,
  failAt,
  fetchWithTimeout,
  type GradedTestResult,
  type GradedTestStep,
  passAll,
} from './types'

const A2A_STEPS: GradedTestStep[] = [
  { key: 'handshake', label: 'Endpoint reachable', status: 'pending' },
  { key: 'auth', label: 'Authentication', status: 'pending' },
  { key: 'tools', label: 'Agent Card parsed', status: 'pending' },
  { key: 'protocol', label: 'Protocol version match', status: 'pending' },
]

const CARD_PATHS = ['/.well-known/agent-card.json', '/.well-known/agent.json', '/agent.json']

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '')
  if (CARD_PATHS.some((p) => trimmed.endsWith(p))) return trimmed
  return `${trimmed}${path}`
}

async function fetchCard(
  baseUrl: string,
  headers: Record<string, string>
): Promise<{ status: number; card: Record<string, unknown> | null; usedUrl: string }> {
  for (const path of CARD_PATHS) {
    const usedUrl = joinUrl(baseUrl, path)
    try {
      const res = await fetchWithTimeout(usedUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
      })
      if (res.status === 401 || res.status === 403) {
        return { status: res.status, card: null, usedUrl }
      }
      if (!res.ok) continue
      const json = (await res.json()) as Record<string, unknown>
      if (json && typeof json === 'object') {
        return { status: res.status, card: json, usedUrl }
      }
    } catch {
      // Non-JSON or unreachable card; fall through to the next candidate URL.
    }
  }
  return { status: 404, card: null, usedUrl: baseUrl }
}

function skillsFromCard(card: Record<string, unknown>): string[] {
  const skills = card.skills
  if (!Array.isArray(skills)) return []
  return skills
    .map((s) => (s && typeof s === 'object' && 'name' in s ? String((s as { name: unknown }).name) : ''))
    .filter(Boolean)
}

export async function discoverA2a(url: string, auth: AuthConfigInput): Promise<AutoDiscoverResult> {
  const startedAt = Date.now()
  const test = await testA2aConnection({ url, protocol: '1.0', auth })
  if (test.ok) {
    return {
      ok: true,
      name: test.name,
      description: test.description,
      protocol: (test.protocol as A2aProtocolUi | undefined) ?? '1.0',
      auth: auth.type,
      toolCount: test.toolCount,
      toolNames: test.toolNames,
      agentCard: test.agentCard,
      durationMs: Date.now() - startedAt,
    }
  }

  if (isLiteLLMConfigured()) {
    try {
      const card = await getA2aGateway().discover({ url, mode: 'well_known_fallback' })
      const names = skillsFromCard(card)
      return {
        ok: Boolean(card.name || names.length),
        name: typeof card.name === 'string' ? card.name : undefined,
        description: typeof card.description === 'string' ? card.description : undefined,
        protocol: typeof card.protocolVersion === 'string' ? String(card.protocolVersion) : '1.0',
        auth: auth.type,
        toolCount: names.length,
        toolNames: names,
        agentCard: card,
        durationMs: Date.now() - startedAt,
      }
    } catch {
      // ignore LiteLLM discover errors
    }
  }

  return {
    ok: false,
    durationMs: Date.now() - startedAt,
  }
}

export async function testA2aConnection(input: {
  url: string
  protocol: A2aProtocolUi
  auth: AuthConfigInput
}): Promise<GradedTestResult> {
  const startedAt = Date.now()
  const url = input.url.trim()
  if (!url) return failAt(A2A_STEPS, 'handshake', 'Endpoint URL is required', startedAt)

  try {
    new URL(url)
  } catch {
    return failAt(A2A_STEPS, 'handshake', 'Invalid URL', startedAt)
  }

  const headers = authHeaders(input.auth)
  try {
    const fetched = await fetchCard(url, headers)
    if (fetched.status === 401 || fetched.status === 403) {
      return failAt(A2A_STEPS, 'auth', `Authentication failed (${fetched.status})`, startedAt)
    }
    if (!fetched.card) {
      return failAt(A2A_STEPS, 'handshake', 'Agent Card not found at well-known paths', startedAt)
    }

    const card = fetched.card
    const names = skillsFromCard(card)
    const cardVersion = String(card.protocolVersion ?? card.version ?? '')
    if (cardVersion && cardVersion !== input.protocol && !cardVersion.startsWith(input.protocol)) {
      return failAt(
        A2A_STEPS,
        'protocol',
        `Agent Card protocolVersion=${cardVersion}, expected ${input.protocol}`,
        startedAt
      )
    }

    return passAll(A2A_STEPS, {
      toolCount: names.length,
      toolNames: names,
      durationMs: Date.now() - startedAt,
      protocol: (cardVersion as A2aProtocolUi) || input.protocol,
      name: typeof card.name === 'string' ? card.name : undefined,
      description: typeof card.description === 'string' ? card.description : undefined,
      agentCard: card,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/abort/i.test(message)) {
      return failAt(A2A_STEPS, 'handshake', 'Connection timed out', startedAt)
    }
    return failAt(A2A_STEPS, 'handshake', message, startedAt)
  }
}
