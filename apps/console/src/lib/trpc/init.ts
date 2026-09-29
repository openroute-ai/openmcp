import { initTRPC, TRPCError } from "@trpc/server"
import superjson from "superjson"
import { ZodError } from "zod"
import { db } from "@/db/client"
import type { auth } from "@/lib/auth"

type Session = typeof auth.$Infer.Session

export type TRPCContext = {
  db: typeof db
  session: Session | null
  headers: Headers
}

/**
 * Reads an application code out of an error cause.
 *
 * `data.code` is already taken by tRPC's own code, so the application code
 * travels beside it as `appCode` rather than shadowing it.
 */
const readAppCode = (cause: unknown): string | null => {
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code: unknown }).code
    if (typeof code === "string") return code
  }
  return null
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        appCode: readAppCode(error.cause),
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

export const createTRPCRouter = t.router
export const createCallerFactory = t.createCallerFactory

export const publicProcedure = t.procedure

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})
