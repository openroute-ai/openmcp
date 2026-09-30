import { Hono } from "hono"
import { env } from "../../lib/env"

/**
 * Thin proxy to the web app Store MCP (`/api/mcp/store`).
 *
 * Full marketplace/acquire/entitlement logic lives in `apps/web` (shares
 * packages/db + skills.acquire). Agents should prefer the web URL directly;
 * this route exists so apps/api documents a stable entry and can forward when
 * OPENMCP_WEB_BASE_URL is configured.
 *
 * Mounted at `/api/v1/mcp/store` (+ nested oauth paths).
 */
const store = new Hono()

function webBase(): string | null {
  const raw = env.OPENMCP_WEB_BASE_URL?.replace(/\/$/, "")
  return raw || null
}

/** Map `/api/v1/mcp/store...` → `/api/mcp/store...` on the web app. */
function targetPathFromRequest(pathname: string): string {
  const marker = "/mcp/store"
  const idx = pathname.indexOf(marker)
  const suffix = idx >= 0 ? pathname.slice(idx + marker.length) : pathname
  return `/api/mcp/store${suffix}`
}

store.all("/*", async (c) => {
  const base = webBase()
  if (!base) {
    return c.json(
      {
        error: "store_mcp_unconfigured",
        message:
          "Store MCP is hosted on the web app. Set OPENMCP_WEB_BASE_URL to enable this proxy, or register the web endpoint directly.",
        register: {
          url: "https://www.openmcp.cn/api/mcp/store",
          headers: { Authorization: "Bearer YOUR_OPENMCP_API_KEY" },
          oauth: {
            deviceCodeUrl: "https://www.openmcp.cn/api/mcp/store/oauth/device",
            tokenUrl: "https://www.openmcp.cn/api/mcp/store/oauth/token",
            verificationUri: "https://www.openmcp.cn/device",
          },
          tools: ["search_assets", "get_asset", "install_asset"],
        },
        docs: "docs/design/AGENT_INSTALL.md",
      },
      501
    )
  }

  const target = new URL(`${base}${targetPathFromRequest(new URL(c.req.url).pathname)}`)
  target.search = new URL(c.req.url).search

  const headers = new Headers()
  const contentType = c.req.header("content-type")
  if (contentType) headers.set("content-type", contentType)
  const authorization = c.req.header("authorization")
  if (authorization) headers.set("authorization", authorization)
  const gatewayKey = c.req.header("x-litellm-api-key")
  if (gatewayKey) headers.set("x-litellm-api-key", gatewayKey)

  const method = c.req.method
  const init: RequestInit = { method, headers }
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    init.body = await c.req.arrayBuffer()
  }

  try {
    const upstream = await fetch(target, init)
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    console.error("[api mcp/store proxy]", error)
    return c.json(
      {
        error: "proxy_error",
        message: "Failed to reach OPENMCP_WEB_BASE_URL Store MCP",
      },
      502
    )
  }
})

export default store
