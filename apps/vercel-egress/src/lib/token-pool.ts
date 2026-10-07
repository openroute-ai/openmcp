/**
 * The GitHub token pool backing Route A.
 *
 * Round-robin with a skip: each request takes the next token, and a token
 * whose last recorded `x-ratelimit-remaining` is zero is skipped until a
 * response carries a fresh window. Keeping the window per token is what makes
 * rotation a set-and-forget operation — token A can be replaced with token C
 * without any toggle or a window where the proxy is unconfigured.
 */
import type { TokenWindow } from "../env"

export class TokenPool {
  private index = 0

  constructor(
    private readonly tokens: string[],
    private readonly windows: Map<string, TokenWindow> = new Map()
  ) {}

  /** How many tokens are configured, for detecting a changed token list. */
  tokenCount(): number {
    return this.tokens.length
  }

  /** The next usable token, or undefined when no tokens are configured. */
  next(): string | undefined {
    if (this.tokens.length === 0) return undefined

    const now = Math.floor(Date.now() / 1000)

    for (let step = 0; step < this.tokens.length; step += 1) {
      // The loop runs only while the array is non-empty, so the index is always
      // in range; `!` narrows `noUncheckedIndexedAccess`.
      const token = this.tokens[(this.index + step) % this.tokens.length]!
      const window = this.windows.get(token)
      const spent = window !== undefined && window.remaining <= 0
      // A spent window is skipped only while it is still in force; once its
      // reset arrives the token is usable again even if we have not seen a
      // fresh response yet.
      if (!spent || window!.reset <= now) {
        this.index = (this.index + step + 1) % this.tokens.length
        return token
      }
    }

    // Every token is spent and unexpired; fall back to round-robin rather than
    // refusing the request — GitHub's 403 still tells the caller what happened.
    const token = this.tokens[this.index % this.tokens.length]!
    this.index = (this.index + 1) % this.tokens.length
    return token
  }

  /** Records a token's rate-limit window from an upstream response. */
  record(token: string, headers: Headers): void {
    const remaining = headers.get("x-ratelimit-remaining")
    const reset = headers.get("x-ratelimit-reset")
    if (remaining === null || reset === null) return

    const remainingNum = Number(remaining)
    const resetNum = Number(reset)
    if (Number.isFinite(remainingNum) && Number.isFinite(resetNum)) {
      this.windows.set(token, { remaining: remainingNum, reset: resetNum })
    }
  }
}