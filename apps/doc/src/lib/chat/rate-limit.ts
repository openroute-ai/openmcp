import "server-only"

import { chatConfig } from "@/lib/chat/config"

/**
 * 进程内滑动窗口限流。
 *
 * 该实现假设 docs 以单实例运行；多副本部署时每个副本各自计数，
 * 如需全局一致应替换为共享存储（Redis 等）。
 */

const hits = new Map<string, number[]>()

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

export function checkRateLimit(ip: string): RateLimitResult {
  const limit = chatConfig.rateLimitPerMin()
  const now = Date.now()
  const windowMs = 60_000
  const windowStart = now - windowMs

  const timestamps = (hits.get(ip) ?? []).filter((t) => t > windowStart)

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] ?? now
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    hits.set(ip, timestamps)
    return { allowed: false, remaining: 0, retryAfterSec }
  }

  timestamps.push(now)
  hits.set(ip, timestamps)
  return { allowed: true, remaining: limit - timestamps.length, retryAfterSec: 0 }
}
