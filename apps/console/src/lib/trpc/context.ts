import { auth } from "@/lib/auth"
import { db } from "@/db/client"
import type { TRPCContext } from "./init"

export async function createTRPCContext(opts: {
  headers: Headers
}): Promise<TRPCContext> {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error(
      "CONSOLE_DATABASE_URL is not set. See apps/console/.env.example."
    )
  }

  const session = await auth.api.getSession({ headers: opts.headers })

  return {
    db,
    session,
    headers: opts.headers,
  }
}
