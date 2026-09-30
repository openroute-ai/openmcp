import { initTRPC, TRPCError } from "@trpc/server"
import superjson from "superjson"
import { ZodError } from "zod"
import { db } from "@/db/client"
import { isAdmin } from "@/lib/auth/role"
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

/**
 * A signed-in account, whatever its role.
 *
 * Deliberately the *first* gate rather than the only one, so a procedure that
 * needs no role check is not tempted to open itself up to anonymous callers: the
 * two procedures below build on this one, never the other way round.
 */
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

/**
 * A signed-in account with the `admin` role.
 *
 * This is the authorization, not the redirect in the `/dashboard` layout. The
 * layout exists so a non-admin is not shown a console whose every query fails,
 * but a page can be reached without rendering its layout's guard — prefetched,
 * fetched directly, or from a client-side navigation — and the only check that
 * cannot be skipped is the one on the procedure itself. Every mutating and
 * operator-facing procedure uses this, so the two gates fail in the same place
 * for a caller that gets past the first one.
 *
 * `FORBIDDEN` rather than `UNAUTHORIZED` for the role check: the caller is
 * authenticated, and reporting otherwise would tell a signed-in non-admin that
 * the resource exists but the session is somehow not accepted, which is a
 * distinction no part of this app acts on.
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isAdmin(ctx.session.user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action is limited to administrators",
    })
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})
