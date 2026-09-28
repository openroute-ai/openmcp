import Redis from "ioredis"
import type { SmsCaptchaConfig } from "../types"

let sharedRedis: Redis | null = null

function getRedisOptions(config?: SmsCaptchaConfig) {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number.parseInt(String(process.env.REDIS_PORT ?? "6379"), 10),
    password: process.env.REDIS_PASSWORD,
    db: Number.parseInt(String(process.env.REDIS_DB ?? "0"), 10),
  }
}

/**
 * 返回全局共享的 Redis 实例。优先使用调用方注入的 `config.redis`，
 * 否则按 REDIS_* 环境变量懒创建一次并缓存。
 */
export function getSharedRedis(config?: SmsCaptchaConfig): Redis | null {
  if (config?.redis) return config.redis
  if (sharedRedis) return sharedRedis
  const { host, port, password, db } = getRedisOptions(config)
  sharedRedis = new Redis({
    host,
    port,
    password,
    db,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: () => null,
  })
  sharedRedis.on("error", (err) => {
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      console.warn("[Redis sms-captcha]", err.message)
    }
  })
  return sharedRedis
}

export function getPrefix(config?: SmsCaptchaConfig): string {
  return config?.prefix ?? ""
}