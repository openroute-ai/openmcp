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
import { forwardGraphqlRequest, forwardRestRequest } from "./lib/github-forward"
import { scanRoute } from "./routes/scan"

export const app = new Hono()

// Fail closed: an unhandled exception (missing EGRESS_SECRET, a helper that
// throws) is 500 with `error: internal`, never a bare stack. Handlers also
// refuse honestly — see `authorize` — but this catches the rest.
app.onError((error, c) => {
  console.error("[egress] unhandled error", error)
  return c.json({ error: "internal", message: "internal server error" }, 500)
})

app.get("/healthz", (c) => c.json({ ok: true }))

// Route A: REST and GraphQL passthrough to GitHub.
// The catch-all `*` matches the full remainder including slashes; the path is
// reconstructed from the request URL because Hono does not expose that segment
// as a named param for a bare wildcard.
app.all("/api/github/rest/*", (c) => {
  const url = new URL(c.req.url)
  const prefix = "/api/github/rest/"
  const path = url.pathname.startsWith(prefix)
    ? decodeURIComponent(url.pathname.slice(prefix.length))
    : ""
  return forwardRestRequest(c, path)
})
app.post("/api/github/graphql", (c) => forwardGraphqlRequest(c))
app.all("/api/github/graphql", (c) => forwardGraphqlRequest(c))

// Route B: Sandbox scan orchestration.
app.post("/api/scan", (c) => scanRoute(c))

app.notFound((c) => c.json({ error: "not found" }, 404))

export default app