import Redis from "ioredis"
import { createRedisRateLimitStorage } from "@workspace/auth"
import type { RateLimitStorage } from "@workspace/auth"

function resolveRedisUrl() {
  const { REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = process.env
  if (REDIS_URL) return REDIS_URL
  if (REDIS_HOST || REDIS_PORT || REDIS_PASSWORD) {
    const auth = REDIS_PASSWORD ? `:${encodeURIComponent(REDIS_PASSWORD)}@` : ""
    return `redis://${auth}${REDIS_HOST ?? "localhost"}:${REDIS_PORT ?? "6379"}`
  }
  return undefined
}

let redisInstance: Redis | null | undefined

export function getRedis(): Redis | null {
  if (redisInstance !== undefined) return redisInstance
  const url = resolveRedisUrl()
  redisInstance =
    url != null
      ? new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          retryStrategy: () => null,
        })
      : null
  if (redisInstance) {
    redisInstance.on("error", (error) => {
      if (process.env.NEXT_PHASE !== "phase-production-build") {
        console.warn("[console] Redis:", error.message)
      }
    })
  }
  return redisInstance
}

let rateLimitStorage: RateLimitStorage | null | undefined

export function getRateLimitStorage(): RateLimitStorage | null {
  if (rateLimitStorage !== undefined) return rateLimitStorage
  const redis = getRedis()
  rateLimitStorage = redis
    ? createRedisRateLimitStorage(redis, { prefix: "openmcp:console:" })
    : null
  return rateLimitStorage
}
