export const appName = "OpenMCP"
export const siteUrl =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
  "https://openmcp.org"

export const docsImageRoute = "/og/docs"
export const docsContentRoute = "/llms.mdx/docs"

/** zh 为默认语言，不带前缀；en 带 `/en` 前缀（与 `hideLocale: default-locale` 一致）。 */
export function localePath(locale: string | undefined, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (!locale || locale === "zh") return normalized
  return `/${locale}${normalized}`
}

export const gitConfig = {
  user: "openroute-ai",
  repo: "openmcp",
  branch: "main",
}
