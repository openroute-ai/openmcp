import type { RequestLike } from "../types"

/**
 * 从请求中解析客户端 IP（考虑代理、CDN）
 */
export function getClientIp(request: RequestLike): string {
  const req: Request | undefined =
    request instanceof Request
      ? request
      : (request as { request?: Request })?.request
  if (!req?.headers) return "0.0.0.0"
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  const xri = req.headers.get("x-real-ip")
  if (xri) return xri.trim()
  return "0.0.0.0"
}