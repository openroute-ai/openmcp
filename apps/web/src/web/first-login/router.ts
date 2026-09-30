import { and, count, eq, gt } from 'drizzle-orm'
import { session, user } from '@workspace/db'
import { db } from '@/lib/db'
import { createTRPCRouter, protectedProcedure } from '@/server/routers/trpc'

/**
 * First-login detection.
 *
 * There is no "has seen the welcome" flag on `user`, so this infers it from
 * timing: a session created within a few minutes of the account itself is a
 * first login. The header uses that to surface the welcome/WeChat prompt once.
 *
 * The prompt's own dismissal is tracked client-side (localStorage), because a
 * user who closed it does not want it back on their second session even though
 * the account is old by then.
 */

/** How close the session must be to the account creation to count as first login. */
const FIRST_LOGIN_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Widened threshold for the single-session case: a user who registered and signed
 * in from a second device minutes later has, from their point of view, just
 * arrived.
 */
const FIRST_LOGIN_SESSION_THRESHOLD_MS = FIRST_LOGIN_THRESHOLD_MS * 2

export const firstLoginRouter = createTRPCRouter({
  checkFirstLogin: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id

    const [currentUser] = await db
      .select({ createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    if (!currentUser) {
      return { isFirstLogin: false, reason: 'user_not_found' as const }
    }

    const [currentSession] = await db
      .select({ createdAt: session.createdAt, expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.id, ctx.session.id))
      .limit(1)

    if (!currentSession) {
      return { isFirstLogin: false, reason: 'session_not_found' as const }
    }

    // An expired session cannot have just signed the user in.
    const now = new Date()
    if (currentSession.expiresAt < now) {
      return { isFirstLogin: false, reason: 'session_expired' as const }
    }

    const userCreatedAt = new Date(currentUser.createdAt)
    const sessionCreatedAt = new Date(currentSession.createdAt)
    const timeDiffMs = Math.abs(sessionCreatedAt.getTime() - userCreatedAt.getTime())

    if (timeDiffMs <= FIRST_LOGIN_THRESHOLD_MS) {
      return {
        isFirstLogin: true,
        reason: 'first_login_detected' as const,
        userCreatedAt: userCreatedAt.toISOString(),
        sessionCreatedAt: sessionCreatedAt.toISOString(),
        timeDiffMinutes: Math.round(timeDiffMs / 60_000),
      }
    }

    const [activeSessions] = await db
      .select({ value: count() })
      .from(session)
      .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))

    const isFirstLogin =
      (activeSessions?.value ?? 0) <= 1 && timeDiffMs <= FIRST_LOGIN_SESSION_THRESHOLD_MS

    return {
      isFirstLogin,
      reason: isFirstLogin ? ('first_login_detected' as const) : ('not_first_login' as const),
      userCreatedAt: userCreatedAt.toISOString(),
      sessionCreatedAt: sessionCreatedAt.toISOString(),
      timeDiffMinutes: Math.round(timeDiffMs / 60_000),
    }
  }),
})
