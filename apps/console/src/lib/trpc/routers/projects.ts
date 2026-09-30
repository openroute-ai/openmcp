import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  bundles,
  hallOfFame,
  hallOfFameToProjects,
  packages,
  projectSkills,
  projectSyncJobs,
  projects,
  projectsToTags,
  repos,
  snapshots,
  tags,
} from "@/db/schema"
import {
  InvalidRepoUrlError,
  createProjectFromRepo,
} from "@/lib/github/service/create-project"
import {
  deleteProject,
  generateUniqueSlug,
  getProjectByFullName,
  NO_DESCRIPTION,
  updateProject,
} from "@/lib/github/service/project"
import {
  listProjectTags,
  setProjectTags,
} from "@/lib/github/service/tag"
import { startProjectResync } from "@/lib/github/service/resync"
import { parseGithubRepoUrl } from "@/lib/github/repo-url"
import { createConsoleLogger } from "@/lib/tasks/runner"
import { createTRPCRouter, adminProcedure } from "../init"

export const projectsRouter = createTRPCRouter({
  /**
   * Curates a new project from a GitHub URL.
   *
   * Idempotent: a repository that already has a project returns that project
   * with `status: "existing"`, so a double submit is harmless.
   */
  create: adminProcedure
    .input(
      z.object({
        url: z.string().min(1),
        // Defaults to the reference app's default, so an omitted type does not
        // silently publish something as a skill.
        type: z.enum(PROJECT_TYPES).default("application"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createProjectFromRepo(
          ctx.db,
          { url: input.url, type: input.type },
          { logger: createConsoleLogger("create-project") }
        )
      } catch (error) {
        if (error instanceof InvalidRepoUrlError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error,
          })
        }
        throw error
      }
    }),

  /**
   * Normalizes a URL without creating anything, for the preview shown while
   * the operator is still typing.
   *
   * Answers the two questions the create button cannot: where the URL actually
   * points, and whether this repository is already curated. Creation is
   * idempotent and reports "already exists" only after the round trip and the
   * GitHub fetch, so without this the operator has no way to find out before
   * committing to the click.
   */
  parseUrl: adminProcedure
    .input(z.object({ url: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const parsed = parseGithubRepoUrl(input.url)
      if (!parsed) return null

      const existing = await getProjectByFullName(
        ctx.db,
        `${parsed.owner}/${parsed.name}`
      )

      return {
        owner: parsed.owner,
        name: parsed.name,
        exists: Boolean(existing),
        projectId: existing?.id ?? null,
      }
    }),

  /**
   * One page of projects, newest first.
   *
   * Paging and searching both happen here rather than in the table. A page is
   * a window on the whole collection, so filtering or slicing it in the client
   * would silently report a total the server never agreed with: a filtered page
   * that holds three rows while the count says four hundred is a bug that only
   * shows up once someone tries to reach the last page. The count comes from the
   * same `where` clause as the rows, so the two cannot disagree.
   *
   * The child rows are gathered for the page's own projects only. Reading the
   * newest few hundred sync jobs and then discarding all but the ones on screen
   * is the shape that made a page of twenty rows cost the same as a page of two
   * hundred, and it silently mislabels the sync column for any project older
   * than the window.
   */
  list: adminProcedure
    .input(
      z.object({
        status: z.enum(PROJECT_STATUSES).optional(),
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions: SQL[] = []
      if (input.status) {
        conditions.push(eq(projects.status, input.status))
      }

      const term = input.search?.trim()
      if (term) {
        // `%` and `_` are wildcards to LIKE, and `\` is its escape character.
        // Left alone they turn a search for "c++" into a query that matches
        // everything, so they are escaped before being wrapped.
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`
        conditions.push(
          or(
            ilike(projects.name, pattern),
            ilike(projects.owner, pattern),
            ilike(projects.description, pattern),
            ilike(projects.slug, pattern)
          )!
        )
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined

      const [rows, counted] = await Promise.all([
        ctx.db
          .select({
            id: projects.id,
            name: projects.name,
            owner: projects.owner,
            slug: projects.slug,
            description: projects.description,
            type: projects.type,
            status: projects.status,
            priority: projects.priority,
            logo: projects.logo,
            createdAt: projects.createdAt,
            // The owner's numeric id, because the avatar CDN is addressed by
            // it and the id form is the only one that serves a size small
            // enough for a table row. Without it a row has no author mark at
            // all, since the icon is often not mirrored yet.
            ownerId: repos.ownerId,
            // The repository's own icon, so a row still has a mark for a
            // project that never got a logo of its own.
            iconUrl: repos.iconUrl,
            stars: repos.stars,
            forks: repos.forks,
            pushedAt: repos.pushedAt,
            repoUrl: sql<string>`'https://github.com/' || ${repos.owner} || '/' || ${repos.name}`,
          })
          .from(projects)
          .leftJoin(repos, eq(projects.repoId, repos.id))
          .where(where)
          .orderBy(desc(projects.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: sql<number>`count(*)::int` })
          .from(projects)
          .where(where)
          .then((counted) => counted[0]),
      ])

      // Nothing to decorate. An empty `inArray` is legal but pointless, and
      // skipping it keeps the page from spending two queries on an empty list.
      const ids = rows.map((row) => row.id)
      const [skillCounts, latestJobs] = ids.length
        ? await Promise.all([
            ctx.db
              .select({
                projectId: projectSkills.projectId,
                count: sql<number>`count(*)::int`,
              })
              .from(projectSkills)
              .where(inArray(projectSkills.projectId, ids))
              .groupBy(projectSkills.projectId),
            ctx.db
              .select({
                id: projectSyncJobs.id,
                projectId: projectSyncJobs.projectId,
                status: projectSyncJobs.status,
                triggeredBy: projectSyncJobs.triggeredBy,
                startedAt: projectSyncJobs.startedAt,
                completedAt: projectSyncJobs.completedAt,
                createdAt: projectSyncJobs.createdAt,
              })
              .from(projectSyncJobs)
              .where(inArray(projectSyncJobs.projectId, ids))
              .orderBy(desc(projectSyncJobs.createdAt)),
          ])
        : [[], []]

      const skillsByProject = new Map(
        skillCounts.map((row) => [row.projectId, row.count])
      )

      // Newest first, so the first row seen for a project is its latest job.
      const jobByProject = new Map<string, (typeof latestJobs)[number]>()
      for (const job of latestJobs) {
        if (!jobByProject.has(job.projectId)) {
          jobByProject.set(job.projectId, job)
        }
      }

      return {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          owner: row.owner,
          slug: row.slug,
          description: row.description,
          type: row.type,
          status: row.status,
          priority: row.priority,
          logo: row.logo,
          createdAt: row.createdAt,
          ownerId: row.ownerId,
          iconUrl: row.iconUrl,
          stars: row.stars,
          forks: row.forks,
          pushedAt: row.pushedAt,
          repoUrl: row.repoUrl,
          skillCount: skillsByProject.get(row.id) ?? 0,
          lastSync: jobByProject.get(row.id) ?? null,
        })),
        total: counted?.value ?? 0,
      }
    }),

  /**
   * One project with everything the database holds about it.
   *
   * The child rows come back with the project rather than behind their own
   * procedures: the page has no interaction that would change them, so a
   * second round trip would only put a skeleton between the header and the
   * tables below it. Hidden projects are readable here because this is the
   * console, and the console lists them too — a detail page that 404s on a row
   * the list just showed is worse than one that opens.
   *
   * The README is included whole, in both languages, rather than as a flag
   * telling the page to fetch it elsewhere. A README is the bulk of what a
   * project is, and a detail page whose main content needs a second request is
   * a detail page that opens empty.
   */
  byId: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select({
          id: projects.id,
          name: projects.name,
          owner: projects.owner,
          slug: projects.slug,
          description: projects.description,
          overrideDescription: projects.overrideDescription,
          url: projects.url,
          overrideUrl: projects.overrideUrl,
          status: projects.status,
          type: projects.type,
          logo: projects.logo,
          twitter: projects.twitter,
          priority: projects.priority,
          comments: projects.comments,
          skillMdPath: projects.skillMdPath,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,

          repoId: repos.id,
          // Carried because the avatar CDN is addressed by id, and the id form
          // is the only one that serves a size small enough for a 56px slot.
          ownerId: repos.ownerId,
          iconUrl: repos.iconUrl,
          openGraphImageUrl: repos.openGraphImageUrl,
          openGraphImageOssUrl: repos.openGraphImageOssUrl,
          usesCustomOpenGraphImage: repos.usesCustomOpenGraphImage,
          stars: repos.stars,
          forks: repos.forks,
          watchersCount: repos.watchersCount,
          topics: repos.topics,
          languages: repos.languages,
          archived: repos.archived,
          repoDescription: repos.description,
          repoDescriptionZh: repos.descriptionZh,
          homepage: repos.homepage,
          defaultBranch: repos.defaultBranch,
          licenseSpdxId: repos.licenseSpdxId,
          pushedAt: repos.pushedAt,
          repoCreatedAt: repos.createdAt,
          repoAddedAt: repos.addedAt,
          repoUpdatedAt: repos.updatedAt,
          lastCommit: repos.lastCommit,
          commitCount: repos.commitCount,
          contributorCount: repos.contributorCount,
          mentionableUsersCount: repos.mentionableUsersCount,
          pullRequestsCount: repos.pullRequestsCount,
          releasesCount: repos.releasesCount,
          readmeContent: repos.readmeContent,
          readmeContentZh: repos.readmeContentZh,
          latestReleaseName: repos.latestReleaseName,
          latestReleaseTagName: repos.latestReleaseTagName,
          latestReleasePublishedAt: repos.latestReleasePublishedAt,
          latestReleaseUrl: repos.latestReleaseUrl,
          latestReleaseDescription: repos.latestReleaseDescription,
          latestReleaseDescriptionZh: repos.latestReleaseDescriptionZh,
          repoUrl: sql<string>`'https://github.com/' || ${repos.owner} || '/' || ${repos.name}`,
        })
        .from(projects)
        .innerJoin(repos, eq(projects.repoId, repos.id))
        .where(eq(projects.id, input.id))
        .limit(1)

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" })
      }

      const [skills, jobs, authors, projectTags, snapshotRows, packageRows] =
        await Promise.all([
          ctx.db
            .select({
              id: projectSkills.id,
              skillDir: projectSkills.skillDir,
              name: projectSkills.name,
              description: projectSkills.description,
              descriptionZh: projectSkills.descriptionZh,
              // Carried as lengths rather than the documents: the page lists
              // skills, and a SKILL.md per row would make the payload larger
              // than the README it sits under.
              readmeLength: sql<number>`length(coalesce(${projectSkills.readme}, ''))::int`,
              readmeZhLength: sql<number>`length(coalesce(${projectSkills.readmeZh}, ''))::int`,
              version: projectSkills.version,
              contentHash: projectSkills.contentHash,
              syncedToWebAt: projectSkills.syncedToWebAt,
              lastSyncAttemptAt: projectSkills.lastSyncAttemptAt,
              lastSyncError: projectSkills.lastSyncError,
              updatedAt: projectSkills.updatedAt,
            })
            .from(projectSkills)
            .where(eq(projectSkills.projectId, input.id))
            .orderBy(asc(projectSkills.name)),
          ctx.db
            .select({
              id: projectSyncJobs.id,
              status: projectSyncJobs.status,
              triggeredBy: projectSyncJobs.triggeredBy,
              errorMessage: projectSyncJobs.errorMessage,
              startedAt: projectSyncJobs.startedAt,
              completedAt: projectSyncJobs.completedAt,
              createdAt: projectSyncJobs.createdAt,
            })
            .from(projectSyncJobs)
            .where(eq(projectSyncJobs.projectId, input.id))
            .orderBy(desc(projectSyncJobs.createdAt))
            .limit(20),
          ctx.db
            .select({
              username: hallOfFame.username,
              name: hallOfFame.name,
              avatarUrl: hallOfFame.avatarUrl,
              avatar: hallOfFame.avatar,
              github: hallOfFame.github,
              homepage: hallOfFame.homepage,
              twitter: hallOfFame.twitter,
              linkedin: hallOfFame.linkedin,
              bio: hallOfFame.bio,
              verified: hallOfFame.verified,
              followers: hallOfFame.followers,
              npmUsername: hallOfFame.npmUsername,
              npmPackageCount: hallOfFame.npmPackageCount,
            })
            .from(hallOfFameToProjects)
            .innerJoin(
              hallOfFame,
              eq(hallOfFameToProjects.username, hallOfFame.username)
            )
            .where(eq(hallOfFameToProjects.projectId, input.id))
            .orderBy(asc(hallOfFame.username)),
          ctx.db
            .select({
              code: tags.code,
              name: tags.name,
              description: tags.description,
              aliases: tags.aliases,
              excludeFromRankings: tags.excludeFromRankings,
            })
            .from(projectsToTags)
            .innerJoin(tags, eq(projectsToTags.tagId, tags.id))
            .where(eq(projectsToTags.projectId, input.id))
            .orderBy(asc(tags.code)),
          ctx.db
            .select({ year: snapshots.year, months: snapshots.months })
            .from(snapshots)
            .where(eq(snapshots.repoId, project.repoId))
            .orderBy(asc(snapshots.year)),
          ctx.db
            .select({
              name: packages.name,
              version: packages.version,
              monthlyDownloads: packages.monthlyDownloads,
              dependencies: packages.dependencies,
              devDependencies: packages.devDependencies,
              deprecated: packages.deprecated,
              updatedAt: packages.updatedAt,
              bundleVersion: bundles.version,
              bundleSize: bundles.size,
              bundleGzip: bundles.gzip,
              bundleError: bundles.errorMessage,
            })
            .from(packages)
            .leftJoin(bundles, eq(bundles.name, packages.name))
            .where(eq(packages.projectId, input.id))
            .orderBy(asc(packages.name)),
        ])

      return {
        ...project,
        skills,
        jobs,
        authors,
        tags: projectTags,
        snapshots: snapshotRows,
        packages: packageRows,
      }
    }),

  /**
   * Applies an editor's decisions to one project.
   *
   * The fields a repository supplies are editable on purpose, but an automatic
   * sync would otherwise put the old value back. Editing a field is what
   * *makes* it an override, so the two flags are set here rather than left to
   * the caller to remember: a human who corrects a description and forgets to
   * tick a box would quietly lose the edit on the next refresh.
   */
  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(5000).nullable().optional(),
        url: z.string().url().nullable().optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
        type: z.enum(PROJECT_TYPES).optional(),
        logo: z.string().min(1).nullable().optional(),
        twitter: z.string().min(1).nullable().optional(),
        priority: z.number().int().min(0).max(1000).optional(),
        comments: z.string().max(5000).nullable().optional(),
        skillMdPath: z.string().max(500).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, description, ...rest } = input

      const current = await ctx.db.query.projects.findFirst({
        where: eq(projects.id, id),
      })
      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        })
      }

      // The column is `notNull`, and an absent description is carried by a
      // sentinel that the ranking filters test for, so clearing the field means
      // writing that sentinel. An empty string would pass the not-null check
      // and still count as described, which is the opposite of the intent.
      const changes: Parameters<typeof updateProject>[2] = {
        ...rest,
        ...(description !== undefined
          ? { description: description ?? NO_DESCRIPTION }
          : {}),
      }

      if (
        changes.description !== undefined &&
        changes.description !== current.description
      ) {
        changes.overrideDescription = true
      }
      if (changes.url !== undefined && changes.url !== current.url) {
        changes.overrideUrl = true
      }

      // Only a genuine rename can collide. Reusing the project's own slug must
      // not append a suffix, so the lookup is skipped unless the slug moves.
      if (rest.name !== undefined && rest.name !== current.name) {
        changes.slug = await generateUniqueSlug(ctx.db, rest.name)
      }

      const updated = await updateProject(ctx.db, id, changes)
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" })
      }
      return updated
    }),

  /**
   * Replaces a project's tags with exactly the given set.
   *
   * Replacing the whole set is what the editor needs: the form shows every tag
   * it can assign, so toggling two and saving is one round trip that cannot
   * lose the edits to a read-modify-write race against a second operator.
   */
  setTags: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        codes: z.array(z.string().min(1)).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, input.id))
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        })
      }

      await setProjectTags(ctx.db, input.id, input.codes)
      return listProjectTags(ctx.db, input.id)
    }),

  /**
   * Deletes a project, and the rows that only exist to describe it.
   *
   * The repositories and the sync jobs are deliberately left behind: they are
   * keyed by owner and name, not by this row, and other projects may still be
   * pointing at the same repository.
   */
  remove: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, input.id))
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        })
      }

      await deleteProject(ctx.db, input.id)
      return { id: input.id }
    }),

  /**
   * Re-fetches one project from GitHub, in the background.
   *
   * Returns a job id immediately rather than the result, because a full refresh
   * is a metadata request, a contributor count, a README fetch, an asset
   * upload, a star snapshot and up to three language-model calls — minutes of
   * work that would outlive a request. The caller polls the job, and the row is
   * the record of the attempt whether it succeeded or not.
   *
   * The source app returned 200 for an untracked fire-and-forget, so a manual
   * sync that failed left no trace and the project page could not tell that
   * anything had happened. Both gaps are what this row and the job list close.
   */
  sync: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      return startProjectResync(ctx.db, {
        projectId: input.id,
        triggeredBy: "manual",
      })
    }),
})
