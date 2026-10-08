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
 *
 * The 32-character floor is a hard fail-closed: a short secret that "works"
 * on one console deployment is a secret every other deployment already shares
 * and one credential-stuffing attack reads byte-for-byte from a timing side
 * channel. Misconfigured here means 500 for every route until fixed, which is
 * the honest shape of "cannot be authenticated securely".
 */
export function egressSecret(): string {
  const value = required("EGRESS_SECRET")
  if (value.length < 32) {
    throw new Error("EGRESS_SECRET must be at least 32 characters")
  }
  return value
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

/** How long a Route-A upstream (`api.github.com`) call may take. */
export function egressForwardTimeoutMs(): number {
  return optionalPositiveInt("EGRESS_FORWARD_TIMEOUT_MS") ?? 30_000
}

/**
 * Largest request body Route A will read before forwarding. Bounded because
 * `forwardRestRequest` buffers the whole body to hand it to `fetch` without a
 * stream — a caller sending unbounded bytes would make this function bigger
 * than the 1 MiB GitHub API accepts anyway.
 */
export function egressMaxRequestBodyBytes(): number {
  return optionalPositiveInt("EGRESS_MAX_REQUEST_BODY_BYTES") ?? 1_024 * 1_024
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