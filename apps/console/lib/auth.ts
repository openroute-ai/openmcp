import { createAuth } from "@workspace/auth"
import { db } from "@/db/client"

export const auth = createAuth(db, {
  baseURL: process.env.CONSOLE_BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((s) => s.trim())
    : [],
})
