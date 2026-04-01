import { createAuth } from "@workspace/auth"
import { db } from "./db"
import { env } from "./env"

export const auth = createAuth(db, {
  baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS,
})
