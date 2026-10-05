/**
 * What a repository submission to console actually sends.
 *
 * The mode switch is the whole point of these cases: `POST /api/v1/projects`
 * publishes and pushes skill documents, `POST /api/v1/repos` only records the
 * repository. Getting them mixed up is not a subtle degradation - one of them
 * puts a repository on the public site, which is exactly what the other exists to
 * prevent - and both failures are invisible from this app's own tables, because
 * the thing that was published lives in console's database.
 *
 * So the assertions are on the request that goes out: which path, and which
 * fields. Not on the response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConsoleApiError,
  consoleFoundNoSkills,
  consoleSubmitMode,
  submitRepo,
} from '../lib/console/client'

const ENV_KEYS = [
  'CONSOLE_API_BASE_URL',
  'CONSOLE_API_KEY',
  'CONSOLE_SKILLS_CALLBACK_SECRET',
  'CONSOLE_SKILLS_CALLBACK_URL',
  'CONSOLE_SKILLS_REGISTER_ONLY',
] as const

let saved: Record<string, string | undefined> = {}

type FetchCall = { url: string; init: RequestInit }
let calls: FetchCall[] = []
let nextResponse: () => Response

function respondWith(body: unknown, status = 200): void {
  nextResponse = () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
}

/**
 * The single call just made. `noUncheckedIndexedAccess` is on, so indexing an
 * array has to be narrowed before its fields can be read.
 */
function onlyCall(): FetchCall {
  expect(calls).toHaveLength(1)
  const call = calls[0]
  if (!call) throw new Error('expected exactly one console call')
  return call
}

function lastBody(): Record<string, unknown> {
  const body = onlyCall().init.body
  expect(typeof body).toBe('string')
  return JSON.parse(body as string) as Record<string, unknown>
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  calls = []
  respondWith({ ok: true, created: true })

  // `getBaseUrl()` is memoised at module load and only matters for the callback
  // URL, so it is the one value here that cannot be set per test.
  process.env.CONSOLE_API_BASE_URL = 'http://console.test'
  process.env.CONSOLE_API_KEY = 'test-key'
  delete process.env.CONSOLE_SKILLS_REGISTER_ONLY
  delete process.env.CONSOLE_SKILLS_CALLBACK_SECRET
  delete process.env.CONSOLE_SKILLS_CALLBACK_URL

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit) => {
      calls.push({ url: String(input), init })
      return nextResponse()
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('consoleSubmitMode', () => {
  it('publishes unless the flag says otherwise', () => {
    // Every deployment before this flag existed published. Defaulting the other
    // way would silently unpublish skills that are live right now.
    expect(consoleSubmitMode()).toBe('publish')
    process.env.CONSOLE_SKILLS_REGISTER_ONLY = ''
    expect(consoleSubmitMode()).toBe('publish')
    process.env.CONSOLE_SKILLS_REGISTER_ONLY = '   '
    expect(consoleSubmitMode()).toBe('publish')
  })

  it('registers on the affirmative spellings', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE', 'True']) {
      process.env.CONSOLE_SKILLS_REGISTER_ONLY = value
      expect(consoleSubmitMode()).toBe('register')
    }
  })

  it('treats the negative spellings as off, not as a typo to fail on', () => {
    // `false`/`0`/`no`/`off` are the vocabulary `local-cron`'s envBool already
    // accepts. A deployment that writes `off` and gets publishing back is
    // exactly the kind of surprise this vocabulary exists to prevent.
    for (const value of ['false', '0', 'no', 'off', 'OFF', 'False']) {
      process.env.CONSOLE_SKILLS_REGISTER_ONLY = value
      expect(consoleSubmitMode()).toBe('publish')
    }
  })
})

describe('submitRepo in publish mode', () => {
  it('posts to /api/v1/projects with the classification', async () => {
    await submitRepo('https://github.com/owner/repo', 'skill')

    const call = onlyCall()
    expect(call.url).toBe('http://console.test/api/v1/projects')
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(lastBody()).toEqual({ url: 'https://github.com/owner/repo', type: 'skill' })
  })

  it('names the delivery address when a signing key is configured', async () => {
    process.env.CONSOLE_SKILLS_CALLBACK_URL = 'https://web.test/api/webhook/daily/skills'
    process.env.CONSOLE_SKILLS_CALLBACK_SECRET = 'shhh'

    await submitRepo('https://github.com/owner/repo', 'skill')

    expect(lastBody()).toMatchObject({
      callbackUrl: 'https://web.test/api/webhook/daily/skills',
      callbackSecret: 'shhh',
    })
  })

  it('reports the mode it used', async () => {
    respondWith({ ok: true, status: 'created' })
    const result = await submitRepo('https://github.com/owner/repo', 'skill')
    expect(result.mode).toBe('publish')
  })
})

describe('submitRepo in register-only mode', () => {
  beforeEach(() => {
    process.env.CONSOLE_SKILLS_REGISTER_ONLY = 'true'
  })

  it('posts to /api/v1/repos instead', async () => {
    await submitRepo('https://github.com/owner/repo', 'skill')

    const call = onlyCall()
    expect(call.url).toBe('http://console.test/api/v1/repos')
    expect(call.init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
  })

  it('sends nothing but the URL', async () => {
    await submitRepo('https://github.com/owner/repo', 'skill')

    // No `type`: console answers 400 `type_not_accepted` on this endpoint, so
    // sending one would turn every registration into a failure that points at
    // the endpoint this mode exists to avoid.
    expect(lastBody()).toEqual({ url: 'https://github.com/owner/repo' })
  })

  it('sends no callback pair even when one is configured', async () => {
    process.env.CONSOLE_SKILLS_CALLBACK_URL = 'https://web.test/api/webhook/daily/skills'
    process.env.CONSOLE_SKILLS_CALLBACK_SECRET = 'shhh'

    await submitRepo('https://github.com/owner/repo', 'skill')

    // Registration syncs no skill documents, so the pair would only buy a
    // one-shot `repo.registered` POST aimed at a route that ingests skills.
    const body = lastBody()
    expect(body.callbackUrl).toBeUndefined()
    expect(body.callbackSecret).toBeUndefined()
  })

  it('ignores the classification it was handed', async () => {
    // The caller passes 'skill' because that is what it would publish. In this
    // mode there is nothing to classify.
    await submitRepo('https://github.com/owner/repo', 'skill')
    expect(lastBody().type).toBeUndefined()
  })

  it('reports the mode it used', async () => {
    respondWith({ ok: true, created: true, projectCount: 0 })
    const result = await submitRepo('https://github.com/owner/repo', 'skill')
    expect(result.mode).toBe('register')
  })
})

describe('submitRepo when console is absent', () => {
  it('fails closed as unconfigured in either mode, without a request', async () => {
    delete process.env.CONSOLE_API_KEY

    for (const mode of ['publish', 'register']) {
      process.env.CONSOLE_SKILLS_REGISTER_ONLY = mode === 'register' ? 'true' : 'false'
      await expect(submitRepo('https://github.com/owner/repo', 'skill')).rejects.toThrow(
        ConsoleApiError
      )
    }
    expect(calls).toHaveLength(0)
  })

  it('marks the failure as unconfigured so callers can fall back', async () => {
    delete process.env.CONSOLE_API_BASE_URL

    await expect(submitRepo('https://github.com/owner/repo', 'skill')).rejects.toMatchObject({
      status: 404,
      notConfigured: true,
    })
  })
})

describe('consoleFoundNoSkills', () => {
  it('reads a repository with no skill document as empty, not as delivered', () => {
    // console 的 `delivered` 是 `pushed === found`：仓库里一个技能都没有时它是
    // 0 === 0 的 true。把它当"技能正在入库"会让调用方把整轮轮询预算花在一份
    // 根本不存在的推送上。
    expect(
      consoleFoundNoSkills({
        ok: true,
        delivered: true,
        skills: { count: 0, translated: 0, empty: true },
        delivery: { found: 0, pushed: 0, failed: 0 },
      })
    ).toBe(true)
  })

  it('does not call a repository empty when console never told us the path', () => {
    // `delivery: null` 是"没有配置投递地址"，不是"没有技能"。它不构成证据。
    expect(consoleFoundNoSkills({ ok: true, delivered: null, delivery: null })).toBe(false)
    expect(consoleFoundNoSkills({ ok: true })).toBe(false)
  })

  it('leaves a real delivery alone', () => {
    expect(
      consoleFoundNoSkills({
        ok: true,
        delivered: false,
        skills: { count: 1, translated: 1, empty: false },
        delivery: { found: 1, pushed: 0, failed: 1 },
      })
    ).toBe(false)
  })
})

describe('submitRepo error reporting', () => {
  it('keeps console\'s own message, which names the missing scope', async () => {
    // The realistic operator mistake is switching the mode without re-minting
    // the key: `projects:write` on a register-only deployment (or the reverse).
    // console answers 403 `insufficient_scope`, and "console returned 403" is
    // not an actionable thing to put in an operator's log.
    respondWith({ error: { code: 'insufficient_scope', message: '需要 repos:write' } }, 403)

    await expect(submitRepo('https://github.com/owner/repo', 'skill')).rejects.toThrow(/repos:write/)
  })

  it('retains the status so scope failures are distinguishable from outages', async () => {
    respondWith({ error: { code: 'github_unavailable', message: 'GitHub token missing' } }, 503)

    const error = await submitRepo('https://github.com/owner/repo', 'skill').catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(ConsoleApiError)
    expect((error as ConsoleApiError).status).toBe(503)
    expect((error as ConsoleApiError).notConfigured).toBe(false)
  })
})