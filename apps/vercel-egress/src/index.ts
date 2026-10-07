/**
 * Local dev server. The production entrypoint is the Vercel function in
 * `api/[[...route]].ts`; this one makes `pnpm dev` a drop-in way to exercise the
 * same Hono app on a real port.
 */
import { serve } from "@hono/node-server"
import app from "./app"

const port = Number(process.env.PORT ?? 3001)

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`vercel-egress dev on http://localhost:${info.port}`)
})

function shutdown(): void {
  server.close(() => process.exit(0))
}

process.on("SIGINT", () => shutdown())
process.on("SIGTERM", () => shutdown())