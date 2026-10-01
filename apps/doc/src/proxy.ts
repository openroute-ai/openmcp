import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation"
import { NextResponse, type NextRequest } from "next/server"

/**
 * 裸路径（zh 默认语言）→ `/zh/...` 段内路由。
 *
 * md 内容路由挂在 `[locale]` 段下（`/zh/llms.mdx/docs/.../content.md`），
 * 因此先算出目标路径，再统一补 `/zh` 前缀；en 走 `/en/...` 原样透传。
 */
const { rewrite: rewriteZhMdx } = rewritePath(
  "/docs{/*path}.mdx",
  "/llms.mdx/docs{/*path}/content.md"
)
const { rewrite: rewriteEnMdx } = rewritePath(
  "/en/docs{/*path}.mdx",
  "/en/llms.mdx/docs{/*path}/content.md"
)
const { rewrite: rewriteZhLlm } = rewritePath(
  "/docs/*path",
  "/llms.mdx/docs/*path/content.md"
)
const { rewrite: rewriteEnLlm } = rewritePath(
  "/en/docs/*path",
  "/en/llms.mdx/docs/*path/content.md"
)

/** 把裸 zh 目标路径补上 `/zh` 段前缀。 */
function withDefaultLocale(path: string): string {
  if (path === "/zh" || path.startsWith("/zh/")) return path
  return `/zh${path}`
}

function rewrite(request: NextRequest, path: string, varyAccept: boolean) {
  const init = varyAccept ? { headers: { Vary: "Accept" } } : undefined
  return NextResponse.rewrite(new URL(path, request.nextUrl), init)
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === "/") {
    return NextResponse.redirect(new URL("/docs", request.nextUrl))
  }

  // 裸的 llms 路径 → 默认语言 zh
  if (pathname === "/llms.txt") {
    return rewrite(request, "/zh/llms.txt", false)
  }
  if (pathname === "/llms-full.txt") {
    return rewrite(request, "/zh/llms-full.txt", false)
  }

  // `/docs/foo.mdx` → 原始 markdown
  const enMdx = rewriteEnMdx(pathname)
  if (enMdx) return rewrite(request, enMdx, false)

  const mdx = rewriteZhMdx(pathname)
  if (mdx) return rewrite(request, withDefaultLocale(mdx), false)

  // 客户端显式请求 markdown 时，`/docs/foo` 直接返回原始 markdown
  if (isMarkdownPreferred(request)) {
    const enLlm = rewriteEnLlm(pathname)
    if (enLlm) return rewrite(request, enLlm, true)

    const llm = rewriteZhLlm(pathname)
    if (llm) return rewrite(request, withDefaultLocale(llm), true)
  }

  // 其余无前缀的 zh 路由重写到 /zh 段
  if (pathname.startsWith("/docs")) {
    return rewrite(request, withDefaultLocale(pathname), false)
  }
  if (pathname.startsWith("/og/docs")) {
    return rewrite(request, withDefaultLocale(pathname), false)
  }
  if (pathname.startsWith("/llms.mdx/docs")) {
    return rewrite(request, withDefaultLocale(pathname), false)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/",
    "/llms.txt",
    "/llms-full.txt",
    "/docs",
    "/docs/:path*",
    "/en/docs",
    "/en/docs/:path*",
    "/og/docs/:path*",
    "/llms.mdx/docs/:path*",
  ],
}
