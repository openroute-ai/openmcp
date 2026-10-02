import { initTRPC, TRPCError } from '@trpc/server'
import type { Session, User } from 'better-auth'
import { ZodError } from 'zod'
import { transformer } from './transformer'

/**
 * 平台角色。
 *
 * 二值 `admin`/`user` 撑不住审核后台：恢复驳回项、覆盖已作出的审核决定、
 * 改扫描规则集这类操作不应该和"看一眼队列"同一个权限。`super_admin` 是
 * `ADMIN_REVIEW_QUEUE_UED.md` §2.2 定的第二级，这里把它落到代码里。
 *
 * 注意与组织内角色（`packages/auth` 的 owner/admin/member）无关——那是
 * organization 插件的角色，与平台管理员完全是两套东西。
 */
export type PlatformRole = 'user' | 'admin' | 'super_admin'

export interface UserWithRole extends User {
  role?: PlatformRole
}

/** 平台管理员（可进后台、可审核）。 */
export function isPlatformAdmin(role: unknown): role is 'admin' | 'super_admin' {
  return role === 'admin' || role === 'super_admin'
}

/** 仅超级管理员（可覆盖决定、改规则集）。 */
export function isSuperAdmin(role: unknown): role is 'super_admin' {
  return role === 'super_admin'
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

/**
 * 需要 `admin` 或 `super_admin`。
 *
 * 之前这里是 `role !== 'admin'` 精确匹配，所以新增 `super_admin` 后必须显式
 * 放行——否则超级管理员会被自己的新角色挡在门外。
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user?.id || !isPlatformAdmin(ctx.user.role)) {
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

/**
 * 需要 `super_admin`：改扫描规则集、覆盖既有审核决定、恢复被驳回项等。
 *
 * 独立成一个 procedure 而不是散落在各 router 里判断，是为了让"这个操作要
 * 最高权限"这件事在路由定义处就能看出来，审计时不用逐个 handler 翻。
 */
export const superAdminProcedure = adminProcedure.use(({ ctx, next }) => {
  if (!isSuperAdmin(ctx.user.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '仅超级管理员可执行此操作',
    })
  }
  return next({ ctx })
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
