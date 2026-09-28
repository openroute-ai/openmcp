import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

config({ path: "../../.env" })

if (!process.env.CONSOLE_DATABASE_URL) {
  throw new Error("CONSOLE_DATABASE_URL is required to run Drizzle commands")
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.CONSOLE_DATABASE_URL,
  },
  strict: true,
  verbose: true,
})
