import type { SmsCaptchaConfig } from "@workspace/sms-captcha"
import { getRedis } from "@/lib/redis"

/**
 * 滑块验证码共享配置：复用 console 的 Redis 单例，key 统一带
 * `openmcp:console:` 前缀，与 auth 限流存储隔离。
 */
export const smsCaptchaConfig: SmsCaptchaConfig = {
  redis: getRedis() ?? undefined,
  prefix: "openmcp:console:",
  apiBasePath: "/api/auth/sms-captcha",
}