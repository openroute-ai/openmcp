import { initTRPC, TRPCError } from '@trpc/server'
import type { Session, User } from 'better-auth'
import { ZodError } from 'zod'
import { transformer } from './transformer'

export interface UserWithRole extends User {
  role?: 'admin' | 'user'
}

export type { Session }

/**
 * 1. CONTEXT
 *
 * The pieces available to every procedure: the incoming headers, the resolved
 * session, and the optional `x-acme-api-key` for machine-to-machine calls.
 */
export interface CreateContextOptions<TRequest> {
  headers: Headers
  user: UserWithRole | null
  session: Session | null
  apiKey?: string | null
  req?: TRequest
}

/**
 * Builds the context without touching Next.js, so tests and
 * `createSSGHelpers` can construct one directly.
 */
export const createInnerTRPCContext = <TRequest>(
  opts: CreateContextOptions<TRequest>
) => {
  return { ...opts }
}

export const createTRPCContext = async <TRequest extends { headers: Headers }>(
  opts: {
    headers: Headers
    req?: TRequest
    user?: UserWithRole | null
    session?: Session | null
  }
) => {
  const apiKey = opts.req?.headers.get('x-acme-api-key')
  return createInnerTRPCContext({
    user: opts.user ?? null,
    session: opts.session ?? null,
    apiKey,
    req: opts.req,
    headers: opts.headers,
  })
}

/**
 * 2. INITIALIZATION
 */
export const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    }
  },
})

/**
 * 3. ROUTER & PROCEDURES
 */
export const createTRPCRouter = t.router
export const router = t.router
export const mergeRouters = t.mergeRouters
export const createCallerFactory = t.createCallerFactory

/**
 * Read-only access for anonymous callers. `ctx.user` may still be populated
 * when the caller happens to be signed in, so handlers can personalise output.
 */
export const publicProcedure = t.procedure

/** Requires a signed-in user. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user?.id) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'User is not allowed to perform this action',
    })
  }
  return next({
    ctx: {
      user: ctx.user as User,
      session: ctx.session as Session,
    },
  })
})

/** Requires a signed-in user with the `admin` role. */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user?.id || ctx.user.role !== 'admin') {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'User is not allowed to perform this action',
    })
  }
  return next({
    ctx: {
      user: ctx.user as UserWithRole,
      session: ctx.session as Session,
    },
  })
})

/** 4. CONTEXT SUGGESTIONS
 *
 * Annotations that let tRPC infer the narrowed context after a procedure runs.
 */
export const TRPC_ERRORS_BY_CODE = {
  UNAUTHORIZED: 'User is not allowed to perform this action',
  FORBIDDEN: 'User is not allowed to access this resource',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Resource already exists',
  PAYMENT_REQUIRED: 'Payment required',
  TOO_MANY_REQUESTS: 'Too many requests',
} as const
