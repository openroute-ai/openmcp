import { serve } from "@hono/node-server"
import app from "./app"
import { pool } from "./lib/db"
import { env } from "./lib/env"

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API running on http://localhost:${info.port}`)
})

function shutdown() {
  server.close(async (err) => {
    if (err) {
      console.error(err)
      process.exit(1)
      return
    }

    try {
      await pool.end()
      process.exit(0)
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })
}

process.on("SIGINT", () => {
  shutdown()
})

process.on("SIGTERM", () => {
  shutdown()
})
