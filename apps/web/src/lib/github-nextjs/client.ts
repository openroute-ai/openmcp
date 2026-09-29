import { parseGithubRepoUrl } from "@/lib/gateway/names"

export interface GithubFetchTriggerResult {
  ok: boolean
  message: string
}

function baseUrl(): string {
  return (process.env.GITHUB_NEXTJS_API_BASE_URL || '').replace(/\/$/, '')
}

function token(): string {
  return process.env.GITHUB_NEXTJS_API_TOKEN || ''
}

export async function triggerGithubFetch(repoUrl: string, type = 'skill'): Promise<GithubFetchTriggerResult> {
  const parsed = parseGithubRepoUrl(repoUrl)
  if (!parsed) {
    return { ok: false, message: 'Invalid GitHub URL' }
  }

  const root = baseUrl()
  const secret = token()
  if (!root || !secret) {
    return {
      ok: false,
      message: 'GITHUB_NEXTJS_API_BASE_URL / GITHUB_NEXTJS_API_TOKEN 未配置，无法触发按需抓取',
    }
  }

  try {
    const res = await fetch(`${root}/api/internal/repos/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ url: repoUrl, owner: parsed.owner, name: parsed.name, type }),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, message: `github-nextjs 返回 ${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true, message: 'Fetch triggered successfully' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to call github-nextjs internal API",
    }
  }
}
