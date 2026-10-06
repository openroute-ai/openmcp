import { and, eq, gte, sql } from "drizzle-orm"
import { z } from "zod"
import {
  apiKeys,
  decisionBoards,
  projectSkills,
  projects,
  repoDailyStats,
  repos,
  subscriptions,
} from "@/db/schema"
import { ownedByUser } from "@/lib/github/service/user-repo"
import { createTRPCRouter, protectedProcedure } from "../init"

/** How many days of history the dashboard's chart is fed. */
export const CONSOLE_CHART_DAYS = 90

/**
 * The user console's own numbers.
 *
 * The operator console has `overview.snapshot`, which counts the whole registry.
 * That is the wrong question here: this account cannot see most of those rows,
 * and a count of things you may not look at is not a summary of anything. Every
 * figure below is scoped to the caller's own submissions through
 * {@link ownedByUser} — the same fragment `repos.list` and `repos.byId` use, so
 * "the dashboard" and "my repositories" cannot disagree about what "mine" means.
 *
 * **A non-admin surface by construction.** `protectedProcedure` rather than
 * `adminProcedure`, so it is readable by exactly the accounts `/console` is for;
 * the layout at `app/[locale]/console/layout.tsx` sends admins to the operator
 * console, and this procedure would answer them with their own submissions
 * rather than the registry if they typed the path anyway.
 */
export const consoleRouter = createTRPCRouter({
  overview: protectedProcedure
    .input(
      z.object({
        /**
         * How much history to read. Bounded rather than open because the query
         * sums a stats row per repository per day, and a caller asking for a
         * decade is asking for work whose result no chart on this page could
         * draw.
         */
        days: z.number().int().min(7).max(CONSOLE_CHART_DAYS).default(CONSOLE_CHART_DAYS),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

      const [repoCount, projectCount, skillRow, apiKeyCount, boardCount, subscriptionCount, series] =
        await Promise.all([
          ctx.db
            .select({ value: sql<number>`count(*)::int` })
            .from(repos)
            .where(ownedByUser(userId)),
          // Joined down to `repos` rather than filtered on a nested subquery, so
          // that `ownedByUser` is applied to the same `repos` relation it is
          // written against. Both hops are many-to-one, so no row is duplicated
          // and the count needs no `distinct`.
          ctx.db
            .select({ value: sql<number>`count(*)::int` })
            .from(projects)
            .innerJoin(repos, eq(repos.id, projects.repoId))
            .where(ownedByUser(userId)),
          ctx.db
            .select({
              // Split the same way the operator snapshot does, because the
              // difference between "not pushed yet" and "push failed" is the
              // question a submitter actually has about a skill of theirs.
              total: sql<number>`count(*)::int`,
              synced: sql<number>`count(*) filter (where ${projectSkills.syncedToWebAt} is not null)::int`,
              failed: sql<number>`count(*) filter (where ${projectSkills.lastSyncError} is not null)::int`,
            })
            .from(projectSkills)
            .innerJoin(projects, eq(projects.id, projectSkills.projectId))
            .innerJoin(repos, eq(repos.id, projects.repoId))
            .where(ownedByUser(userId))
            .then((rows) => rows[0]),
          // Revoked keys stay counted: the page answers "how many keys do I
          // have", and a key that was revoked is still a key this account
          // issued. Dropping them would make the number change by revoking
          // something rather than by doing anything.
          ctx.db
            .select({ value: sql<number>`count(*)::int` })
            .from(apiKeys)
            .where(eq(apiKeys.userId, userId)),
          ctx.db
            .select({ value: sql<number>`count(*)::int` })
            .from(decisionBoards)
            .where(eq(decisionBoards.ownerId, userId)),
          ctx.db
            .select({ value: sql<number>`count(*)::int` })
            .from(subscriptions)
            .where(eq(subscriptions.userId, userId)),

          // One row per day per repository, summed across the account's
          // repositories: what the chart draws is how many stars *their*
          // repositories hold on each day, which is a cumulative quantity and
          // therefore the one an area chart is for.
          //
          // Grouped on the formatted day rather than the timestamp, because the
          // rows are written at whatever time the sweep ran and a UTC midnight
          // boundary would split one day across two groups.
          ctx.db
            .select({
              date: sql<string>`to_char(${repoDailyStats.period}, 'YYYY-MM-DD')`,
              stars: sql<number>`coalesce(sum(${repoDailyStats.totalStars}), 0)::int`,
              forks: sql<number>`coalesce(sum(${repoDailyStats.totalForks}), 0)::int`,
            })
            .from(repoDailyStats)
            .innerJoin(repos, eq(repos.id, repoDailyStats.repoId))
            .where(and(ownedByUser(userId), gte(repoDailyStats.period, since)))
            .groupBy(sql`to_char(${repoDailyStats.period}, 'YYYY-MM-DD')`)
            .orderBy(sql`to_char(${repoDailyStats.period}, 'YYYY-MM-DD')`),
        ])

      return {
        totals: {
          repos: repoCount[0]?.value ?? 0,
          projects: projectCount[0]?.value ?? 0,
          skills: skillRow?.total ?? 0,
          skillsSynced: skillRow?.synced ?? 0,
          skillsFailed: skillRow?.failed ?? 0,
          apiKeys: apiKeyCount[0]?.value ?? 0,
          boards: boardCount[0]?.value ?? 0,
          subscriptions: subscriptionCount[0]?.value ?? 0,
        },
        series: series.map((row) => ({
          date: row.date,
          stars: row.stars,
          forks: row.forks,
        })),
      }
    }),
})