/**
 * 共享密钥鉴权，路由 A 与路由 B 的公共入口。
 *
 * `X-Egress-Secret` 是多个国内 console 部署共享的密钥，错误地用普通 `!==`
 * 比较的话，对失败分支的计时就能按字节还原它——这正是 `timingSafeEqual`
 * 存在的原因。先 `sha256` 两边再比，是因为 `timingSafeEqual` 要求两输入等长，
 * 哈希后无论密钥多长都是固定 32 字节，比较耗时不再随长度泄漏信息。
 *
 * 失败返回 401，而不是抛错交给 `onError`：这是一次正常鉴权失败，不是
 * 内部异常，不该记成 500。`/healthz` 之外的路由都先过这里。
 */
import { createHash, timingSafeEqual } from "node:crypto"
import type { Context } from "hono"
import { egressSecret } from "../env"

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

/** 校验通过返回 `null`，否则返回 401 响应。 */
export function requireEgressSecret(c: Context): Response | null {
  const expected = egressSecret()
  const supplied = c.req.header("x-egress-secret")
  const ok =
    supplied !== undefined &&
    timingSafeEqual(digest(supplied), digest(expected))
  if (ok) return null
  return c.json(
    { error: "unauthorized", message: "invalid x-egress-secret" },
    401
  )
}
