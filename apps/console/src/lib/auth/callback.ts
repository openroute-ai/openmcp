/**
 * 登录/注册之后回哪儿。
 *
 * 结账弹窗是这条路径的起点：用户从定价卡点「开始监控」、被送去登录，回来时必须
 * 落在 `/?plan=pro` 而不是首页——否则那趟登录看起来什么都没发生，用户会再点一次
 * 「开始监控」、再被送去登录一次。
 *
 * 回跳地址来自查询参数，所以它是一个**开放重定向**的天然入口：`//evil.com` 会把
 * 登录后的导航送到别的域。这里的判断只放行站内绝对路径——以单个 `/` 开头、不是
 * `//`、不含反斜杠与换行（IE 会把 `\` 归一成 `/`，浏览器会吃掉换行）。判定为不合法
 * 就返回 undefined，调用方退回默认落点，而不是拒绝登录。
 */
export const DEFAULT_CALLBACK = "/"

/** 站内路径白名单。不合法一律返回 `undefined`（= 用默认落点），不抛错。 */
export function safeCallbackPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) return undefined
  if (!trimmed.startsWith("/")) return undefined
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return undefined
  if (/[\\\r\n]/.test(trimmed)) return undefined
  return trimmed
}

/** 把回跳地址接到另一个认证页的链接上（登录 ↔ 注册互跳时要带着它）。 */
export function withCallback(path: string, callbackURL: string | undefined): string {
  if (!callbackURL) return path
  return `${path}?callbackURL=${encodeURIComponent(callbackURL)}`
}
