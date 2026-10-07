/**
 * Egress proxy environment.
 *
 * Fail closed: a missing `EGRESS_SECRET` makes every route refuse to run, so a
 * deployment that forgot to configure the shared secret cannot degrade into an
 * open proxy for the GitHub API.
 */

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const optionalPositiveInt = (name: string): number | undefined => {
  const raw = process.env[name]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

/**
 * The shared secret the domestic console sends as `X-Egress-Secret`. Every
 * route checks it; no route runs without it.
 */
export function egressSecret(): string {
  return required("EGRESS_SECRET")
}

/**
 * GitHub tokens this proxy may use. Multiple tokens are supported so an
 * operator can rotate one out without taking the proxy down — add the new
 * token, then remove the old one once its requests have drained.
 *
 * `GITHUB_TOKENS` is a comma-separated list; the single `GITHUB_ACCESS_TOKEN`
 * is kept as a fallback so the documented Vercel setup keeps working.
 */
export function githubTokens(): string[] {
  const list = process.env.GITHUB_TOKENS?.trim()
  if (list) {
    const tokens = list
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
    if (tokens.length > 0) return tokens
  }
  const single = process.env.GITHUB_ACCESS_TOKEN?.trim()
  return single ? [single] : []
}

/** Holds one token's rate-limit window, so the pool can skip it while spent. */
export interface TokenWindow {
  remaining: number
  reset: number
}

export function sandboxTimeoutMs(): number {
  return optionalPositiveInt("SKILL_SCAN_SANDBOX_TIMEOUT_MS") ?? 120_000
}

export function sandboxCommandTimeoutMs(): number {
  return optionalPositiveInt("SKILL_SCAN_COMMAND_TIMEOUT_MS") ?? 60_000
}

export function sandboxVcpus(): number {
  return optionalPositiveInt("SKILL_SCAN_SANDBOX_VCPUS") ?? 1
}

export function skillScanMaxFiles(): number | undefined {
  return optionalPositiveInt("SKILL_SCAN_MAX_FILES")
}

export function skillScanMaxTotalBytes(): number | undefined {
  return optionalPositiveInt("SKILL_SCAN_MAX_TOTAL_BYTES")
}

export function skillScanMaxFileBytes(): number | undefined {
  return optionalPositiveInt("SKILL_SCAN_MAX_FILE_BYTES")
}