/**
 * The egress Hono app.
 *
 * Routes mirror the design doc (`docs/design/design-vercel-egress-proxy-and-sandbox.md`):
 * `/api/github/rest/*` and `/api/github/graphql` forward GitHub API calls, and
 * `/api/scan` orchestrates a Sandbox security scan. Every route is guarded by
 * `X-Egress-Secret`. `maxDuration` lives on the Vercel function entry
 * (`api/[[...route]].ts`), not here — this file is framework-agnostic.
 */
import { Hono } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { forwardGraphqlRequest, forwardRestRequest } from "./lib/github-forward"
import { scanRoute } from "./routes/scan"

export const app = new Hono()

// Fail closed: an unhandled exception is 500 with `error: internal`, never a
// bare stack. Errors that carry their own HTTP `status` — the 413 the body
// limit throws, for example — are replied with that status and, being 4xx, do
// not get logged as server faults. `authorize` and the scan route return 401
// responses directly rather than throwing, so this only ever fires on real
// internal failures.
app.onError((error, c) => {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined
  if (status !== undefined && Number.isInteger(status) && status >= 400 && status < 500) {
    return c.json(
      { error: "bad_request", message: error instanceof Error ? error.message : "bad request" },
      status as ContentfulStatusCode
    )
  }

  console.error("[egress] unhandled error", error)
  return c.json({ error: "internal", message: "internal server error" }, 500)
})

// `/healthz` is the local-dev affordance; Vercel only routes `/api/*` into the
// function, so the reachable one there is `/api/healthz`. Both are public by
// design — the point of a health check is to report without credentials.
app.get("/healthz", (c) => c.json({ ok: true }))
app.get("/api/healthz", (c) => c.json({ ok: true }))

// Route A: REST and GraphQL passthrough to GitHub.
// The catch-all `*` matches the full remainder including slashes; the path is
// reconstructed from the request URL because Hono does not expose that segment
// as a named param for a bare wildcard.
app.all("/api/github/rest/*", (c) => {
  const url = new URL(c.req.url)
  const prefix = "/api/github/rest/"
  const path = url.pathname.startsWith(prefix)
    ? decodePath(url.pathname, prefix)
    : ""
  return forwardRestRequest(c, path)
})
app.post("/api/github/graphql", (c) => forwardGraphqlRequest(c))
app.all("/api/github/graphql", (c) => forwardGraphqlRequest(c))

// Route B: Sandbox scan orchestration.
app.post("/api/scan", (c) => scanRoute(c))

app.notFound((c) => c.json({ error: "not found" }, 404))

export default app

/**
 * The remainder is attacker-controlled; a malformed percent-encoding would
 * otherwise throw inside the route and surface as an internal error.
 */
function decodePath(pathname: string, prefix: string): string {
  try {
    return decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    throw new BadPathError("malformed percent-encoding in path")
  }
}

class BadPathError extends Error {
  readonly status = 400
}