/**
 * The single Vercel function all `/api/*` paths route into.
 *
 * `[[...route]]` is the catch-all filename: Vercel forwards every path under
 * `/api/` here with its original URL, so the Hono app matches against
 * `/api/github/rest/*`, `/api/github/graphql` and `/api/scan` as written,
 * without vercel.json rewrites.
 *
 * The handler is written by hand rather than via the `hono/vercel` adapter,
 * which is marked deprecated (its `handle` moves to a separate `@hono/vercel`
 * package in Hono 5). `app.fetch` is the whole contract, so the indirection
 * buys nothing.
 */
import { app } from "../src/app"

export const config = {
  // Route B needs the native runtime for `@vercel/sandbox`.
  runtime: "nodejs",
  // Hobby ceiling; the sandbox gets 120s and the in-sandbox command 60s.
  maxDuration: 300,
}

export default async function handler(req: Request): Promise<Response> {
  return app.fetch(req)
}