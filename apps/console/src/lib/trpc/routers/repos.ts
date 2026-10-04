import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { createGitHubClient } from "@/lib/github/client"
import { languageNames } from "@/lib/github/languages"
import { parseGithubRepoUrl } from "@/lib/github/repo-url"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import { refreshRepoFromGitHub } from "@/lib/github/sync-project"
import {
  curateRepo,
  getRepoByFullName,
  getRepoById,
  setRepoCreatedBy,
  upsertRepo,
} from "@/lib/github/service/repo"
import {
  listMonthlyStats,
  listWeeklyArrivals,
  monthlyBars,
  periodTrends,
} from "@/lib/github/service/stats"
import { lastNWeeks } from "@/lib/github/snapshot-dates"
import { createConsoleLogger } from "@/lib/tasks/runner"
import { projects, repos, USER_REPO_STATUSES } from "@/db/schema"
import { countProjectsForRepo } from "@/lib/github/service/project"
import {
  countRepoSubmitters,
  getUserRepo,
  linkUserToRepo,
  listRepoSubmitters,
  recomputePlatformStates,
  updateUserRepo,
} from "@/lib/github/service/user-repo"
import { isAdmin } from "@/lib/auth/role"
import { createTRPCRouter, adminProcedure, protectedProcedure } from "../init"

/** How many months of star history the chart shows. */
const CHART_MONTHS = 12

/** How many weeks of star history the chart shows. */
const CHART_WEEKS = 12

/**
 * The repository registry.
 *
 * A repository is not a project. Curating one turns it into a project with a
 * description, a status and a slot on the site; plenty of repositories here are
 * only ever the thing a project points at, and a few are recorded by the
 * discovery sweep and never curated at all. Those orphans are invisible from the
 * project pages, and they are not free — every one of them is a row the daily
 * GitHub sweep spends requests on forever. This router is how they are found.
 *
 * **This is the only router a non-admin can reach**, and only its two read/write
 * procedures: `list` and `create`. Everything an operator curates — the
 * description and homepage an editor owns, the refresh, the delete that cascades
 * into projects — is `adminProcedure`, because a repository row is an editorial
 * decision and an editorial decision is not something a signed-in account gets
 * to make. The two audiences do not, however, see the same rows: for a
 * non-admin, `list` and `byId` narrow to the repositories that account added
 * itself, because `/console` is titled "我的仓库" and the registry they would
 * otherwise see is the operator's, not theirs. Both still go through this one
 * query, so the two views cannot drift in columns, filters or ordering.
 */
export const reposRouter = createTRPCRouter({
  /**
   * The repositories the caller may see, filtered by whether anything points
   * at one and by who added it.
   *
   * An admin sees the whole registry; anyone else sees only the rows their own
   * additions created. The scope is pushed as one more condition rather than
   * branched into a second query, so the search, the `curated` / `orphan` split
   * and the pagination stay identical for both audiences.
   *
   * That split is the reason the operator page exists rather than a link to
   * each project, so it is part of the query instead of something the caller
   * has to infer from a project count it was handed.
   */
  list: protectedProcedure
    .input(
      z.object({
        /**
         * `curated` has at least one project, `orphan` has none. `archived` is
         * separate because a repository GitHub archived is a different question
         * from one nobody chose, and only the first can be answered by
         * refreshing it.
         */
        filter: z.enum(["all", "curated", "orphan", "archived"]).default("all"),
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = []

      // Who added a repository, not who curates it: an admin sees the whole
      // registry — the pool the discovery sweep fills and the dashboard
      // curates — while anyone else sees only their own additions. Unowned rows
      // match no non-admin, which is the point of the null.
      if (!isAdmin(ctx.session.user)) {
        conditions.push(eq(repos.createdBy, ctx.session.user.id))
      }

      const term = input.search?.trim()
      if (term) {
        // `%` and `_` are wildcards to LIKE, and `\` is its escape character.
        // Left alone they turn a search for "c++" into a query that matches
        // everything, so they are escaped before being wrapped.
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
        conditions.push(
          or(
            ilike(repos.name, pattern),
            ilike(repos.owner, pattern),
            ilike(repos.description, pattern)
          )!
        )
      }

      if (input.filter === "archived") {
        conditions.push(eq(repos.archived, true))
      } else if (input.filter === "curated" || input.filter === "orphan") {
        // Written as NOT EXISTS rather than a join, so a repository pointed at
        // by two projects is still one row and the count stays the total count
        // of repositories rather than of relationships.
        const hasProject = sql`exists (
          select 1 from ${projects} where ${projects.repoId} = ${repos.id}
        )`
        conditions.push(
          input.filter === "curated"
            ? sql`${hasProject}`
            : sql`not ${hasProject}`
        )
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined

      // Newest first by when the repository was recorded, not by when it was
      // last refreshed: a repository discovered an hour ago that refreshes
      // cleanly is still the one an operator is most likely to be looking at.
      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            id: repos.id,
            owner: repos.owner,
            name: repos.name,
            description: repos.description,
            descriptionZh: repos.descriptionZh,
            homepage: repos.homepage,
            stars: repos.stars,
            forks: repos.forks,
            topics: repos.topics,
            archived: repos.archived,
            licenseSpdxId: repos.licenseSpdxId,
            contributorCount: repos.contributorCount,
            defaultBranch: repos.defaultBranch,
            iconUrl: repos.iconUrl,
            openGraphImageUrl: repos.openGraphImageUrl,
            overrideDescription: repos.overrideDescription,
            overrideHomepage: repos.overrideHomepage,
            addedAt: repos.addedAt,
            updatedAt: repos.updatedAt,
            pushedAt: repos.pushedAt,
            lastCommit: repos.lastCommit,
            commitCount: repos.commitCount,
            projectCount: sql<number>`(
              select count(*)::int from ${projects} where ${projects.repoId} = ${repos.id}
            )`,
          })
          .from(repos)
          .where(where)
          .orderBy(desc(repos.addedAt), asc(repos.owner), asc(repos.name))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: sql<number>`count(*)::int` })
          .from(repos)
          .where(where)
          .then((counted) => counted[0]),
      ])

      return {
        items: rows.map((row) => ({
          ...row,
          fullName: `${row.owner}/${row.name}`,
          repoUrl: `https://github.com/${row.owner}/${row.name}`,
        })),
        total: counted?.value ?? 0,
      }
    }),

  /**
   * Records a repository by its GitHub reference.
   *
   * There is no operator-facing way to add a repository without this, and
   * without it the only writers were the discovery sweep and project creation:
   * a repository an operator wanted tracked had to be discovered by accident
   * or attached to a project first.
   *
   * The metadata comes from GitHub rather than from the operator, because a row
   * cannot be half-built — `pushed_at` and `created_at` are not nullable and
   * every counter on the page would be null. So this is an upsert against
   * `(owner, name)`, and the result says whether the repository was new, because
   * adding one that was already tracked should not read as a fresh discovery.
   *
   * Accepts every shape a human is likely to paste — a URL, an SSH remote, a
   * bare `owner/name` — through the same parser the ingest route uses.
   *
   * Available to any signed-in account, because "record a repository someone
   * wants tracked" is the whole of what `/console` may do. It is not curation:
   * the row it writes points at nothing, is not a project, and is not synced as
   * one until an admin links a project to it (see
   * `src/lib/tasks/tasks/update-github-data.ts`).
   *
   * The caller becomes the row's `created_by` when the row is new or has no
   * owner yet, which is what puts it in that account's own `/console` list. A
   * row already owned by another account is refreshed under its owner rather
   * than reassigned.
   */
  /**
   * One repository, in full, for the detail page a reader opens from the list.
   *
   * `protectedProcedure` rather than `adminProcedure`, and read-only in
   * consequence: it is the one query behind `/console`'s detail page, and a
   * page that is only ever shown to an operator would not need one. Nothing
   * here writes, and the fields it returns are GitHub's own — no curation
   * decision, no `override` flag, no refresh control — so a signed-in account
   * reading it learns the same thing reading the row on GitHub.
   *
   * A non-admin may open only a row they added. The scope is part of the query
   * rather than a check after it, so a caller guessing an id gets the same
   * `NOT_FOUND` as one asking for a repository that does not exist: the list
   * never showed them anything else, so there is no third answer to give.
   *
   * The child rows come back with the repository rather than behind their own
   * procedures, for the reason `projects.byId` gives: the page has no
   * interaction that would change them, so a second round trip would only put
   * a skeleton between the header and the tables below it.
   *
   * The linked projects are the reason a reader opens this page at all. From
   * the list a repository is a count; here it is the projects that count
   * belongs to, and whether they are published is the question the reader came
   * to answer. So they are named in full rather than summarised, and their
   * status and type come along because "is this live" and "is it a plugin" are
   * what distinguishes one from another.
   *
   * Star history is included whole and computed here, so the chart, the
   * headline numbers and the history table are one read of one set of rows
   * rather than three that could disagree.
   */
  byId: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [repo] = await ctx.db
        .select({
          id: repos.id,
          owner: repos.owner,
          name: repos.name,
          ownerId: repos.ownerId,
          description: repos.description,
          descriptionZh: repos.descriptionZh,
          homepage: repos.homepage,
          iconUrl: repos.iconUrl,
          openGraphImageUrl: repos.openGraphImageUrl,
          // The two override flags, because the edit dialog on this page has
          // to show them. Without them the operator cannot tell whether an edit
          // will survive tomorrow's sweep, which is the one thing the dialog
          // exists to warn about.
          overrideDescription: repos.overrideDescription,
          overrideHomepage: repos.overrideHomepage,
          topics: repos.topics,
          languages: repos.languages,
          licenseSpdxId: repos.licenseSpdxId,
          stars: repos.stars,
          forks: repos.forks,
          watchersCount: repos.watchersCount,
          contributorCount: repos.contributorCount,
          mentionableUsersCount: repos.mentionableUsersCount,
          pullRequestsCount: repos.pullRequestsCount,
          releasesCount: repos.releasesCount,
          commitCount: repos.commitCount,
          defaultBranch: repos.defaultBranch,
          archived: repos.archived,
          pushedAt: repos.pushedAt,
          createdAt: repos.createdAt,
          lastCommit: repos.lastCommit,
          addedAt: repos.addedAt,
          updatedAt: repos.updatedAt,
          readmeContent: repos.readmeContent,
          readmeContentZh: repos.readmeContentZh,
          latestReleaseName: repos.latestReleaseName,
          latestReleaseTagName: repos.latestReleaseTagName,
          latestReleasePublishedAt: repos.latestReleasePublishedAt,
          latestReleaseUrl: repos.latestReleaseUrl,
        })
        .from(repos)
        .where(
          isAdmin(ctx.session.user)
            ? eq(repos.id, input.id)
            : and(
                eq(repos.id, input.id),
                eq(repos.createdBy, ctx.session.user.id)
              )
        )
        .limit(1)

      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      const [
        linked,
        monthlyRows,
        weeklyRows,
        submitters,
        submitterCount,
        ownSubmission,
      ] = await Promise.all([
        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            owner: projects.owner,
            slug: projects.slug,
            description: projects.description,
            status: projects.status,
            type: projects.type,
            logo: projects.logo,
            url: projects.url,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .where(eq(projects.repoId, repo.id))
          .orderBy(asc(projects.name)),
        listMonthlyStats(ctx.db, repo.id),
        // Only the weeks the chart can show. The table holds a row per week
        // since the first stargazer, which for an old repository is years of
        // rows, and the page needs a year of them at most.
        listWeeklyArrivals(ctx.db, repo.id, CHART_WEEKS),
        // Only an admin gets the list of who submitted this. A non-admin is not
        // shown a redacted version of it — they are shown their own row and a
        // count, so no query they can reach can return another account's note.
        // See `user-repo.ts` on why the two audiences need different shapes
        // rather than a filter.
        isAdmin(ctx.session.user) ? listRepoSubmitters(ctx.db, repo.id) : [],
        // The count goes to both audiences: "three people asked for this to be
        // tracked" is a public fact about the repository, unlike *what* each of
        // them wrote down about it.
        countRepoSubmitters(ctx.db, repo.id),
        // The reader's own row, for both audiences. An admin sees it here and
        // also in `submitters`, which is deliberate rather than redundant: the
        // editable controls only ever act on this one, so it is the copy the UI
        // writes to.
        getUserRepo(ctx.db, ctx.session.user.id, repo.id),
      ])

      return {
        ...repo,
        // Normalised rather than the column as stored: rows written before the
        // current writer hold `{"name": …}` objects, and `LabelRow` renders one
        // badge per entry. See `github/languages.ts`.
        languages: languageNames(repo.languages),
        fullName: `${repo.owner}/${repo.name}`,
        repoUrl: `https://github.com/${repo.owner}/${repo.name}`,
        projects: linked,
        submitters,
        submitterCount: submitterCount.total,
        ownSubmission: ownSubmission ?? null,
        monthlyStats: monthlyRows,
        trends: {
          bars: monthlyBars(monthlyRows, CHART_MONTHS, new Date()),
          weeks: lastNWeeks(CHART_WEEKS, new Date()).map((yearWeek) => ({
            yearWeek,
            stars:
              weeklyRows.find(
                (row) =>
                  row.yearWeek.year === yearWeek.year &&
                  row.yearWeek.week === yearWeek.week
              )?.stars ?? 0,
          })),
          periods: periodTrends(monthlyRows, weeklyRows),
        },
      }
    }),

  create: protectedProcedure
    .input(z.object({ repository: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const parsed = parseGithubRepoUrl(input.repository)
      if (!parsed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "repos.create.unparseable",
        })
      }

      const existing = await getRepoByFullName(ctx.db, parsed.fullName)

      const logger = createConsoleLogger("repos.create")
      let info: RepoInfo
      try {
        info = await createGitHubClient().fetchRepoInfo(parsed.fullName)
      } catch (error) {
        // Not the caller's fault if the repository is private, gone, or the
        // token cannot see it, so the reason is passed along rather than
        // reported as a validation failure.
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "repos.create.fetchFailed",
          cause: {
            detail: error instanceof Error ? error.message : String(error),
          },
        })
      }

      const row = await upsertRepo(ctx.db, info)
      logger.info(`${existing ? "refreshed" : "added"} ${parsed.fullName}`)

      // An unowned row is claimed by its first console adder, so an "added"
      // repository is always one the adder can then see in their own list. A
      // row already owned by another account is refreshed but left with its
      // owner: pasting the same URL must not hand ownership over.
      if (!existing?.createdBy) {
        await setRepoCreatedBy(ctx.db, row.id, ctx.session.user.id)
      }

      // Every submitter gets a row of their own, including the first one and
      // including someone whose paste landed on a repository another account had
      // already recorded. `created_by` above answers "who recorded it"; this
      // answers "who wants it tracked", and the second question has more than
      // one right answer — a second paste is a statement of interest, not an
      // attempt to take the row.
      await linkUserToRepo(ctx.db, {
        userId: ctx.session.user.id,
        repoId: row.id,
        source: "console",
      })
      await recomputePlatformStates(ctx.db, [row.id])

      return {
        id: row.id,
        fullName: `${row.owner}/${row.name}`,
        repoUrl: `https://github.com/${row.owner}/${row.name}`,
        created: !existing,
        projectCount: await countProjectsForRepo(ctx.db, row.id),
      }
    }),

  /**
   * 改**自己**对这一个仓库的处置。
   *
   * `protectedProcedure`，输入里只有 `repoId` 和四个私有字段，没有 `userId`：
   * 账号从会话里取，所以这条接口在结构上就不可能改到别人那一行上去。这比
   * "读一个 userId 再校验它是不是你"更可靠——校验可以被忘记，字段不存在不会。
   *
   * 刻意不接受 `platformStatus`：那是关于仓库的事实，不是关于某个人的判断，
   * 由 `recomputePlatformStates` 从 `repos` 和 `projects` 算出来。同理不接受
   * `source` 与 `submittedAt`：它们记录"谁在什么时候提交过"，而那是一次提交的
   * 事实，不会因为有人改了备注而变。
   */
  updateOwnSubmission: protectedProcedure
    .input(
      z.object({
        repoId: z.string().min(1),
        status: z.enum(USER_REPO_STATUSES).optional(),
        note: z.string().max(2000).nullable().optional(),
        pinned: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ok = await updateUserRepo(ctx.db, {
        userId: ctx.session.user.id,
        repoId: input.repoId,
        status: input.status,
        note: input.note,
        pinned: input.pinned,
      })

      if (!ok) {
        // No row for this pair. Distinct from a bad input: the caller asked to
        // update something they never created, and saying so is more useful than
        // reporting success for a write that touched nothing.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "repos.updateOwnSubmission.notSubmitted",
        })
      }

      return { repoId: input.repoId }
    }),

  /**
   * Edits the hand-curated fields of a repository.
   *
   * Only fields that are not GitHub's alone. `description` and `homepage` are
   * GitHub's, so editing one also raises the flag that stops the daily sweep
   * from writing over it — otherwise the edit would be gone by the next
   * morning, and an editor that silently loses work is worse than no editor.
   * `descriptionZh` and `iconUrl` are ours already.
   *
   * Every field is optional and an absent one is left alone, so this is a
   * partial write rather than a whole-row replace.
   */
  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        description: z.string().max(1000).nullable().optional(),
        descriptionZh: z.string().max(1000).nullable().optional(),
        homepage: z.string().url().max(500).nullable().optional(),
        iconUrl: z.string().url().max(1000).nullable().optional(),
        /**
         * `false` hands the field back to GitHub, letting the next sweep
         * overwrite it. This has to be expressible from the editor, or the
         * "until you clear it back" the description promises has no control
         * behind it and a field could never be released once edited.
         */
        overrideDescription: z.boolean().optional(),
        overrideHomepage: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input
      const current = await getRepoById(ctx.db, id)
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" })
      }

      // The "only if it changed" rule lives in `curateRepo`, which compares
      // against the stored row. Applying a second copy of it here would be a
      // second source of truth for when a flag is raised, and the two would
      // eventually disagree.
      const updated = await curateRepo(ctx.db, id, fields)
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" })
      }

      const changed = Object.entries(fields)
        .filter(([key, value]) => {
          if (key === "overrideDescription") {
            return current.overrideDescription !== value
          }
          if (key === "overrideHomepage") {
            return current.overrideHomepage !== value
          }
          return current[key as keyof typeof current] !== value
        })
        .map(([key]) => key)

      return {
        id: updated.id,
        fullName: `${updated.owner}/${updated.name}`,
        updated: changed,
      }
    }),

  /**
   * Re-reads one repository from GitHub.
   *
   * The same per-repository path the daily sweep uses, so a manual refresh and
   * a scheduled one cannot produce different data. It is a mutation rather than
   * a query because it costs several API calls and writes.
   */
  refresh: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const repo = await getRepoById(ctx.db, input.id)
      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" })
      }

      const logger = createConsoleLogger("repos.refresh")
      const result = await refreshRepoFromGitHub(
        ctx.db,
        createGitHubClient(),
        repo,
        { logger }
      )

      const steps = [
        ["readme", result.readme],
        ["contributorCount", result.contributorCount],
        ["icon", result.icon],
        ["openGraphImage", result.openGraphImage],
        ["snapshot", result.snapshot],
      ] as const
      const failed = steps.filter(([, ok]) => !ok).map(([name]) => name)

      // `repos.updated_at` moved, and every submission of this repository
      // mirrors it as "the platform last refreshed this". Recomputed after the
      // work rather than before it, so a partial failure is still reflected —
      // a refresh that read metadata and failed on the README did happen.
      await recomputePlatformStates(ctx.db, [repo.id])

      return {
        refreshed: await getRepoById(ctx.db, input.id),
        // Partial failure is normal, not an error: GitHub rate-limits the
        // contributor and README endpoints harder than the metadata query, and
        // the sweep reports the same outcome as a warning. Throwing would
        // present a metadata refresh as a total failure.
        failed,
        ok: failed.length === 0,
        // A field an operator has taken over is not part of the refresh, so
        // saying so keeps "the refresh did not change my description" from
        // reading as a bug.
        preserved: {
          description: repo.overrideDescription === true,
          homepage: repo.overrideHomepage === true,
        },
      }
    }),

  /**
   * Removes a repository and everything that hangs off it.
   *
   * Refused by default when projects point at it. The foreign key cascades, so
   * deleting a curated repository silently deletes its projects, their tags,
   * their skills and their sync history — and a repository row is recoverable
   * while a curation decision is not. `force` is how an operator says they
   * meant it, and the confirmation states the project count either way.
   */
  delete: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        force: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const repo = await getRepoById(ctx.db, input.id)
      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" })
      }

      const linked = await ctx.db
        .select({ id: projects.id, name: projects.name, slug: projects.slug })
        .from(projects)
        .where(eq(projects.repoId, repo.id))

      if (linked.length > 0 && !input.force) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "repos.delete.blocked",
        })
      }

      await ctx.db.delete(repos).where(eq(repos.id, input.id))

      return {
        id: input.id,
        fullName: `${repo.owner}/${repo.name}`,
        // Reported so the operator can see the size of what they just did
        // rather than having to trust the number they were warned with.
        deletedProjects: linked,
      }
    }),
})
