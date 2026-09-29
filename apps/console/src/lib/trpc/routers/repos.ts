import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { createGitHubClient } from "@/lib/github/client"
import { refreshRepoFromGitHub } from "@/lib/github/sync-project"
import { getRepoById } from "@/lib/github/service/repo"
import { createConsoleLogger } from "@/lib/tasks/runner"
import { projects, repos } from "@/db/schema"
import { createTRPCRouter, protectedProcedure } from "../init"

/**
 * The repository registry, seen from an operator rather than a project.
 *
 * A repository is not a project. Curating one turns it into a project with a
 * description, a status and a slot on the site; plenty of repositories here are
 * only ever the thing a project points at, and a few are recorded by the
 * discovery sweep and never curated at all. Those orphans are invisible from the
 * project pages, and they are not free — every one of them is a row the daily
 * GitHub sweep spends requests on forever. This router is how they are found.
 */
export const reposRouter = createTRPCRouter({
  /**
   * Every recorded repository, filtered by whether anything points at it.
   *
   * The `curated` / `orphan` split is the reason this page exists rather than a
   * link to each project, so it is part of the query instead of something the
   * caller has to infer from a project count it was handed.
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
            stars: repos.stars,
            forks: repos.forks,
            topics: repos.topics,
            archived: repos.archived,
            licenseSpdxId: repos.licenseSpdxId,
            contributorCount: repos.contributorCount,
            defaultBranch: repos.defaultBranch,
            iconUrl: repos.iconUrl,
            openGraphImageUrl: repos.openGraphImageUrl,
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
   * One repository with the projects that point at it.
   *
   * The projects are included because the delete confirmation cannot be written
   * without them: a repository cascades to its projects, so the number of rows
   * about to disappear is the whole question an operator is being asked.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const repo = await getRepoById(ctx.db, input.id)
      if (!repo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Repo not found" })
      }

      const linked = await ctx.db
        .select({
          id: projects.id,
          name: projects.name,
          owner: projects.owner,
          slug: projects.slug,
          status: projects.status,
          type: projects.type,
        })
        .from(projects)
        .where(eq(projects.repoId, repo.id))

      return {
        ...repo,
        fullName: `${repo.owner}/${repo.name}`,
        repoUrl: `https://github.com/${repo.owner}/${repo.name}`,
        projects: linked,
      }
    }),

  /**
   * Re-reads one repository from GitHub.
   *
   * The same per-repository path the daily sweep uses, so a manual refresh and
   * a scheduled one cannot produce different data. It is a mutation rather than
   * a query because it costs several API calls and writes.
   */
  refresh: protectedProcedure
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
      const failed = steps
        .filter(([, ok]) => !ok)
        .map(([name]) => name)

      return {
        refreshed: await getRepoById(ctx.db, input.id),
        // Partial failure is normal, not an error: GitHub rate-limits the
        // contributor and README endpoints harder than the metadata query, and
        // the sweep reports the same outcome as a warning. Throwing would
        // present a metadata refresh as a total failure.
        failed,
        ok: failed.length === 0,
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
  delete: protectedProcedure
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

  /**
   * Repository ids and full names, for anything that needs to select one.
   *
   * Not paginated on purpose: a picker is given the whole list to search, and
   * a page of a truncated list is a list that silently cannot find something.
   */
  options: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: repos.id,
        owner: repos.owner,
        name: repos.name,
        updatedAt: repos.updatedAt,
      })
      .from(repos)
      .orderBy(asc(repos.owner), asc(repos.name))
    return rows.map((row) => ({ ...row, fullName: `${row.owner}/${row.name}` }))
  }),
})
