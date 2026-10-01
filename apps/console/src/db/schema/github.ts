import { relations } from "drizzle-orm"
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core"

/**
 * Schema for the GitHub data-sync domain.
 *
 * Migrated from `apps/github-nextjs` in the n8nshow monorepo and rewritten
 * on the way over:
 *
 * - Columns keep their original snake_case names so the shape of the data
 *   is unchanged, but every Drizzle property is camelCase. The source mixed
 *   the two (`repoData.default_branch` alongside `repoData.owner_id`) and
 *   callers had to remember which was which.
 * - Tables live in the default `public` schema alongside the console's own
 *   tables, as agreed: this module is the reason the domain tables exist
 *   here, so an extra Postgres schema would only add indirection.
 */

export const PROJECT_STATUSES = [
  "active",
  "featured",
  "promoted",
  "deprecated",
  "hidden",
] as const

export const PROJECT_TYPES = [
  "client",
  "server",
  "application",
  "skill",
  "persona",
] as const

/**
 * The orders a project list can be read in, as the reference app spells them:
 * the column, with a leading `-` for descending.
 *
 * Lives beside the enums rather than in the router because both ends need it —
 * the endpoint validates against it and the picker offers it — and a list the
 * client can request and the server will refuse is a dead control.
 */
export const PROJECT_SORTS = [
  "-stars",
  "stars",
  "-createdAt",
  "createdAt",
] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type ProjectType = (typeof PROJECT_TYPES)[number]
export type ProjectSort = (typeof PROJECT_SORTS)[number]

/**
 * The tags the source app excluded from every ranking.
 *
 * Created tags default their `excludeFromRankings` column to membership in
 * this list, so the behavior survives the move from a hardcoded comparison to
 * per-tag configuration. Once a tag row exists the column is authoritative,
 * and an editor can clear it; the list is only a default for new tags.
 */
export const TAGS_EXCLUDED_FROM_RANKINGS = ["meta", "learning", "wildcard"]

export const repos = pgTable(
  "repos",
  {
    id: text("id").primaryKey(),
    /** When the repository was first recorded by this system. */
    addedAt: timestamp("added_at").notNull().defaultNow(),
    /** Last successful stats refresh. */
    updatedAt: timestamp("updated_at"),

    name: text("name").notNull(),
    owner: text("owner").notNull(),
    /** GitHub's numeric user id, needed to build avatar URLs. */
    ownerId: integer("owner_id").notNull(),

    stars: integer("stargazers_count"),
    forks: integer("forks"),
    watchersCount: integer("watchers_count"),
    topics: jsonb("topics").$type<string[]>(),
    archived: boolean("archived"),
    description: text("description"),
    homepage: text("homepage"),
    defaultBranch: text("default_branch"),
    licenseSpdxId: text("license_spdx_id"),
    languages: jsonb("languages").$type<string[]>(),

    /**
     * Unused. Declared only so the column that already exists in the deployed
     * database stays declared: an undeclared-but-present column is the one kind
     * of schema/database disagreement `drizzle-kit push` resolves by *dropping*,
     * so every push would offer to delete it.
     *
     * The project-level classification is `projects.type`, an enum
     * (`client | server | application | skill | persona`). This one is a plain
     * `varchar(20)` left over from an earlier schema, its rows all reading
     * `'application'`, and nothing queries it. Do not read it as a second source
     * of truth for a project's type — that is `projects.type`, and the two are
     * not kept in sync.
     */
    type: varchar("type", { length: 20 })
      .notNull()
      .default("application"),

    /**
     * Unused, and nullable. Same reason as `type` above: kept declared so
     * `push` will not offer to drop it. There is no `author` relation anywhere
     * in this schema, so nothing can join to it.
     */
    authorId: text("author_id"),

    /**
     * The account that added this repository through `/console`, or null when
     * the system recorded it on its own — the discovery sweep and project
     * creation both call `upsertRepo` with nobody to attribute.
     *
     * Null is meaningful rather than missing: a repository with no creator
     * belongs to the registry, not to a person, so it is listed only for an
     * admin. `/console` and `/console/repos/[id]` filter on this, which is what
     * makes "我的仓库" mean *mine* instead of the whole registry.
     *
     * Plain text rather than a foreign key to `user`: `../schema` owns `user`
     * and imports this file, so a reference here would close an import cycle.
     * `authorId` above is unattached too, though for its own reasons.
     */
    createdBy: text("created_by"),

    pushedAt: timestamp("pushed_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    lastCommit: timestamp("last_commit"),
    commitCount: integer("commit_count"),

    /**
     * Contributor count. Read from the REST API rather than by scraping the
     * repository page: the source implementation parsed the contributors
     * counter out of the HTML with a CSS selector, which breaks silently
     * whenever GitHub changes its markup.
     */
    contributorCount: integer("contributor_count"),

    mentionableUsersCount: integer("mentionable_users_count"),
    pullRequestsCount: integer("pull_requests_count"),
    releasesCount: integer("releases_count"),

    /**
     * Open issues excluding pull requests, read from GraphQL's `issues`
     * connection.
     *
     * REST's `open_issues_count` counts open pull requests too, so it cannot
     * back this column: a repository with 100 open PRs and no open issues
     * reports 100 either way, and the two are different questions.
     */
    openIssuesCount: integer("open_issues_count"),

    openGraphImageUrl: text("open_graph_image_url"),
    usesCustomOpenGraphImage: boolean("uses_custom_open_graph_image"),
    latestReleaseName: text("latest_release_name"),
    latestReleaseTagName: text("latest_release_tag_name"),
    latestReleasePublishedAt: timestamp("latest_release_published_at"),
    latestReleaseUrl: text("latest_release_url"),
    latestReleaseDescription: text("latest_release_description"),
    latestReleaseDescriptionZh: text("latest_release_description_zh"),

    readmeContent: text("readme_content"),
    readmeContentZh: text("readme_content_zh"),
    descriptionZh: text("description_zh"),
    iconUrl: text("icon_url"),
    openGraphImageOssUrl: text("open_graph_image_oss_url"),

    /**
     * Set once a human has edited these, so a refresh leaves them alone.
     *
     * The same arrangement `projects` uses, and for the same reason: the daily
     * sweep overwrites `description` and `homepage` from GitHub on every pass,
     * so an editor that changed either of them would watch their edit disappear
     * a few hours later. The flag is what makes the repository editor worth
     * having. The `*_zh` columns have no flag because nothing but a translator
     * and an operator ever writes them.
     */
    overrideDescription: boolean("override_description"),
    overrideHomepage: boolean("override_homepage"),
  },
  (table) => [
    uniqueIndex("repos_name_owner_index").on(table.owner, table.name),
    index("repos_pushed_at_idx").on(table.pushedAt),
    index("repos_created_by_idx").on(table.createdBy),
  ]
)

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    owner: text("owner").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull(),
    /** Set once a human has edited the description, so refreshes skip it. */
    overrideDescription: boolean("override_description"),
    url: text("url"),
    overrideUrl: boolean("override_url"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull(),
    type: text("type", { enum: PROJECT_TYPES })
      .notNull()
      .default("application"),
    logo: text("logo"),
    twitter: text("twitter"),
    priority: smallint("priority").notNull().default(0),
    comments: text("comments"),
    /** Path of the skill document: a file, or a directory in repo mode. */
    skillMdPath: text("skill_md_path").default("SKILL.md"),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("projects_owner_name_unique").on(table.owner, table.name),
    index("projects_repo_id_idx").on(table.repoId),
    index("projects_status_idx").on(table.status),
    index("projects_type_idx").on(table.type),
  ]
)

export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    aliases: jsonb("aliases").$type<string[]>(),
    /**
     * Whether projects carrying this tag are left out of the rankings.
     *
     * The source app compared every project's tags against a constant and left a
     * TODO to move it here. The column is that move: it is the source of truth
     * at ranking time, migration `0003` sets it for the three codes the source
     * excluded, and tag creation applies `TAGS_EXCLUDED_FROM_RANKINGS` as the
     * default so a fresh install behaves like the source did without the
     * comparison happening anywhere at ranking time.
     */
    excludeFromRankings: boolean("exclude_from_rankings")
      .notNull()
      .default(false),
    /**
     * Human-in-the-loop review state, added for radar's AI auto-classification
     * (docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.3).
     *
     * The classifier proposes, an operator confirms. `confidence` is the
     * model's own score and `evidence` the README sentence it cited, so a
     * reviewer judges the reason rather than the conclusion — that is what makes
     * a 2000-repo batch a 10x-leverage task instead of 2000 decisions.
     *
     * `reviewed_at` being null is the work queue, not an error: a tag applied
     * with no review yet is a pending suggestion, and it is still queryable
     * because low-confidence unreviewed tags are exactly what the review UI
     * sorts by. `confidence` is nullable for the same reason — the manually
     * applied tags that predate the classifier have no score.
     */
    confidence: doublePrecision("confidence"),
    evidence: text("evidence"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    // The review queue reads "unreviewed, lowest confidence first", which needs
    // both columns in one index.
    index("tags_unreviewed_by_confidence_idx").on(
      table.reviewedAt,
      table.confidence
    ),
  ]
)

export const projectsToTags = pgTable(
  "projects_to_tags",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.tagId] }),
    // `setProjectTags` reads a project's tags and the tag picker lists codes;
    // both go through this direction.
    index("projects_to_tags_tag_id_idx").on(table.tagId),
  ]
)

/**
 * The axes a capability can be stated on.
 *
 * Kept as a closed set rather than a free string: "which projects deploy
 * themselves" has to be answerable by a filter, and a free-word column answers
 * it approximately at best. Each axis is filtered independently, which is why
 * `deployment` is not folded into `category` — a self-hosted thing is usually
 * also a server and also an application, so putting it in the category would
 * make the two facts indistinguishable (docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.3).
 */
export const CAPABILITY_AXES = [
  /** What it is: language, library, service, framework. */
  "category",
  /** Implementation language. */
  "language",
  /** self-hosted | saas | api — orthogonal to `category`. */
  "deployment",
  /** Auth style: oauth | mtls | apikey | none. */
  "auth",
  /** What it talks to: postgres | kafka | grpc ... */
  "dataSource",
  /** Runtime requirement: kubernetes | docker | wasm. */
  "runtime",
] as const

export type CapabilityAxis = (typeof CAPABILITY_AXES)[number]

/**
 * Closed vocabulary for one axis.
 *
 * Separate from `tags` on purpose. `tags` is the taxonomy an operator curates
 * and the rankings filter on; capabilities are the machine-fillable properties
 * that answer concrete filter questions ("Postgres", "K8s", "OAuth"). Mixing
 * them is what produces a taxonomy nobody can filter.
 */
export const capabilities = pgTable(
  "capabilities",
  {
    id: text("id").primaryKey(),
    axis: text("axis").$type<CapabilityAxis>().notNull(),
    /** Machine key within the axis, unique per axis rather than globally: `en` is
     * one `language` value and would be a meaningless `category` one. */
    code: text("code").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    /**
     * Same review contract as `tags.confidence` — the classifier proposes and an
     * operator confirms.
     */
    confidence: doublePrecision("confidence"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("capabilities_axis_code_unique").on(table.axis, table.code),
    index("capabilities_axis_idx").on(table.axis),
  ]
)

/**
 * A project's capabilities.
 *
 * Long form of `projects_to_tags` and kept beside it rather than merged into
 * it: tags are "this is a database", capabilities are "this speaks Postgres".
 * A filter for the first is a taxonomy lookup, for the second a value
 * existence check, and the two answer at different granularities.
 */
export const projectsToCapabilities = pgTable(
  "projects_to_capabilities",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "cascade" }),
    /** The README sentence the classifier cited. Reviewable, not just auditable. */
    evidence: text("evidence"),
    confidence: doublePrecision("confidence"),
    /** Classifier proposals an operator rejected, so a rerun does not re-propose them. */
    rejected: boolean("rejected").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.capabilityId] }),
    // The filter direction: "every project with capability X" and "every
    // capability of project Y" both go through this.
    index("projects_to_capabilities_capability_id_idx").on(table.capabilityId),
  ]
)

/**
 * The nine counters every stats table carries, and the two ways each is read.
 *
 * `total_*` is the level at the end of the period; `delta_*` is what changed
 * during it. They are stored side by side rather than derived because the two
 * answer different questions and neither is recoverable from the other alone: a
 * repository that gained 40 stars while 6 were removed has `delta_stars` of 34
 * and `delta_new_stars` of 40, and a reader asking "is this growing" wants the
 * first while one asking "how much attention arrived" wants the second.
 *
 * A NULL is not zero. It means the counter was not measured for that period —
 * a repository nobody curated has no contributor count, and writing 0 there
 * would claim the repository lost every contributor it ever had.
 */
const statsCounters = {
  totalStars: integer("total_stars"),
  deltaStars: integer("delta_stars"),
  /** Stargazers who arrived during the period, before any were removed. */
  deltaNewStars: integer("delta_new_stars"),

  totalWatchers: integer("total_watchers"),
  deltaWatchers: integer("delta_watchers"),
  totalForks: integer("total_forks"),
  deltaForks: integer("delta_forks"),
  totalOpenIssues: integer("total_open_issues"),
  deltaOpenIssues: integer("delta_open_issues"),
  totalPullRequests: integer("total_pull_requests"),
  deltaPullRequests: integer("delta_pull_requests"),
  totalReleases: integer("total_releases"),
  deltaReleases: integer("delta_releases"),
  totalContributors: integer("total_contributors"),
  deltaContributors: integer("delta_contributors"),
  totalCommits: integer("total_commits"),
  deltaCommits: integer("delta_commits"),
  totalDownloads: integer("total_downloads"),
  deltaDownloads: integer("delta_downloads"),
}

/** The two timestamps every table this module owns carries. */
const statsTimestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
}

/**
 * One row per repository per calendar month.
 *
 * The period is keyed by an instant rather than a (year, month) pair because
 * that is what a calendar month actually is: Asia/Shanghai's October begins at
 * an instant eight hours before UTC's does, and the rankings and the detail
 * chart both mean the team's month, not the server's. Storing the moment keeps
 * that boundary in one place — `periodInstant` in `lib/time.ts` — instead of
 * leaving each reader to re-derive which midnight was meant.
 *
 * Every period from the first recorded one through the current one gets a row.
 * A gap would otherwise have to mean two different things: "nothing was
 * measured" and "nothing happened", which a reader cannot tell apart and would
 * have to guess at. Dense rows make the second case an explicit 0.
 */
export const repoMonthlyStats = pgTable(
  "repo_monthly_stats",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    period: timestamp("period", { withTimezone: true }).notNull(),
    ...statsCounters,
    ...statsTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.period] }),
    // The ranking task reads one month across every repository.
    index("repo_monthly_stats_period_idx").on(table.period),
  ]
)

/**
 * The same shape at ISO-week granularity.
 *
 * A month cannot answer a weekly question: a week that straddles the 1st is
 * split across two rows, and no combination of them recovers the week's real
 * change. `period` is the Monday the week opened on.
 */
export const repoWeeklyStats = pgTable(
  "repo_weekly_stats",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    period: timestamp("period", { withTimezone: true }).notNull(),
    ...statsCounters,
    ...statsTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.period] }),
    index("repo_weekly_stats_period_idx").on(table.period),
  ]
)

/**
 * The same shape at daily granularity, for the public project detail chart.
 *
 * The two coarser tables are not a substitute: a month is the finest a ranking
 * can compare, and a chart that shows weekly bars hides the day a repository
 * actually jumped.
 *
 * Every day is kept. The sweep used to write only a trailing 90-day window,
 * because it read one row per stargazer and a decade-old repository would have
 * cost 3650 mostly-empty rows. Reading the counts from GitHub's aggregate star
 * history costs one request per 30 weeks instead, so the reason for the window
 * is gone and the history is worth keeping whole.
 */
export const repoDailyStats = pgTable(
  "repo_daily_stats",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    period: timestamp("period", { withTimezone: true }).notNull(),
    ...statsCounters,
    ...statsTimestamps,
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.period] }),
    // The chart reads a window across every repository it is comparing.
    index("repo_daily_stats_period_idx").on(table.period),
  ]
)

/**
 * Every stargazer this system has ever seen, with the moment they starred.
 *
 * Nothing reads this table yet, and that is the point: GitHub restricts the
 * per-stargazer endpoint to repository administrators and collaborators, so it
 * answers 403 for most of the public repositories here and will answer 403 for
 * all of them if the policy tightens further. What is in this table cannot be
 * reconstructed from the counts in the stats tables above, so it is worth
 * keeping: a row read once while access lasted is a row that is still there
 * afterwards.
 *
 * `starredAt` is GitHub's own timestamp and is therefore a property of the
 * stargazer, not of this system. `createdAt` records when this system learned
 * of it, which is a different fact and the only one that says anything about
 * the coverage of the table: a gap between the two is the window in which
 * stargazers arrived while nothing was sweeping.
 */
export const repoStargazers = pgTable(
  "repo_stargazers",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    /** The GitHub login that starred. Renamed upstream, so the same person spans rows. */
    login: text("login").notNull(),
    starredAt: timestamp("starred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.login] }),
    // An incremental sweep asks for everyone who starred after the latest
    // timestamp already stored, which is an index seek rather than a scan.
    index("repo_stargazers_starred_at_idx").on(
      table.repoId,
      table.starredAt
    ),
  ]
)

export const packages = pgTable(
  "packages",
  {
    name: text("name").primaryKey(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    version: text("version"),
    monthlyDownloads: integer("downloads"),
    dependencies: jsonb("dependencies").$type<string[]>(),
    devDependencies: jsonb("dev_dependencies").$type<string[]>(),
    deprecated: boolean("deprecated"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("packages_project_id_idx").on(table.projectId)]
)

export const bundles = pgTable("bundles", {
  name: text("name")
    .primaryKey()
    .references(() => packages.name, { onDelete: "cascade" }),
  version: text("version"),
  size: integer("size"),
  gzip: integer("gzip"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
})

export const hallOfFame = pgTable("hall_of_fame", {
  username: text("username").primaryKey(),
  name: text("name").notNull(),
  followers: integer("followers"),
  bio: text("bio"),
  homepage: text("homepage"),
  twitter: text("twitter"),
  avatar: text("avatar"),
  avatarUrl: text("avatar_url"),
  linkedin: text("linkedin"),
  github: text("github"),
  verified: boolean("verified").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  npmUsername: text("npm_username"),
  npmPackageCount: integer("npm_package_count"),
  status: text("status", { enum: ["active", "inactive", "archived"] })
    .default("active")
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
})

export const hallOfFameToProjects = pgTable(
  "hall_of_fame_to_projects",
  {
    username: text("username")
      .notNull()
      .references(() => hallOfFame.username, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.username, table.projectId] })]
)

export const SYNC_JOB_STATUSES = [
  "pending",
  "running",
  "success",
  "failed",
] as const

export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number]

export const projectSyncJobs = pgTable(
  "project_sync_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    status: text("status", { enum: SYNC_JOB_STATUSES })
      .notNull()
      .default("pending"),
    triggeredBy: text("triggered_by").notNull(),
    /** Destination captured when the job was created, so a retry is stable. */
    webhookUrl: text("webhook_url"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("project_sync_jobs_status_idx").on(table.status),
    index("project_sync_jobs_project_id_idx").on(table.projectId),
    index("project_sync_jobs_created_at_idx").on(table.createdAt),
  ]
)

export const readmeSyncJobs = pgTable(
  "readme_sync_jobs",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    status: text("status", { enum: SYNC_JOB_STATUSES })
      .notNull()
      .default("pending"),
    triggeredBy: text("triggered_by").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("readme_sync_jobs_status_idx").on(table.status),
    index("readme_sync_jobs_created_at_idx").on(table.createdAt),
  ]
)

/**
 * One row per (project, skill directory) holding the parsed and translated
 * SKILL.md, so the documents can be queried locally and pushed downstream.
 */
export const projectSkills = pgTable(
  "project_skills",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    skillDir: text("skill_dir").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    descriptionZh: text("description_zh").notNull().default(""),
    readme: text("readme").notNull(),
    readmeZh: text("readme_zh").notNull().default(""),
    version: text("version"),
    contentHash: text("content_hash"),
    syncedToWebAt: timestamp("synced_to_web_at"),
    lastSyncError: text("last_sync_error"),
    lastSyncAttemptAt: timestamp("last_sync_attempt_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("project_skills_project_id_skill_dir_idx").on(
      table.projectId,
      table.skillDir
    ),
    index("project_skills_synced_to_web_at_idx").on(table.syncedToWebAt),
  ]
)

export const TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const taskDefinitions = pgTable(
  "task_definitions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description"),
    /** Cron expression, interpreted in Asia/Shanghai. */
    cronExpression: text("cron_expression"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isDaily: boolean("is_daily").notNull().default(false),
    isWeekly: boolean("is_weekly").notNull().default(false),
    isMonthly: boolean("is_monthly").notNull().default(false),
    taskType: text("task_type").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("task_definitions_is_enabled_idx").on(table.isEnabled)]
)

export const taskExecutions = pgTable(
  "task_executions",
  {
    id: text("id").primaryKey(),
    taskDefinitionId: text("task_definition_id")
      .notNull()
      .references(() => taskDefinitions.id, { onDelete: "cascade" }),
    status: text("status", { enum: TASK_STATUSES })
      .notNull()
      .default("pending"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    duration: integer("duration"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    logs: text("logs"),
    triggeredBy: text("triggered_by").notNull().default("system"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("task_executions_task_definition_id_idx").on(table.taskDefinitionId),
    index("task_executions_created_at_idx").on(table.createdAt),
  ]
)

/**
 * One row per task, holding the cross-process run lock. Vercel runs each
 * request in its own instance with no shared memory, so the source app's
 * in-memory `runningTasks` map could not prevent two concurrent runs of
 * the same task. This table is the lock.
 */
export const taskStatus = pgTable(
  "task_status",
  {
    taskDefinitionId: text("task_definition_id")
      .primaryKey()
      .references(() => taskDefinitions.id, { onDelete: "cascade" }),
    isRunning: boolean("is_running").notNull().default(false),
    lastRunAt: timestamp("last_run_at"),
    /**
     * Unused, and kept rather than dropped: nothing here reads it, because the
     * next run a task is owed is derived from the cron expression and the
     * execution history. Dropping the column needs its own migration.
     */
    nextRunAt: timestamp("next_run_at"),
    lastExecutionId: text("last_execution_id"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("task_status_is_running_idx").on(table.isRunning)]
)

/**
 * Rising Stars category configuration.
 *
 * The source app read this from `../javascript-risingstars/src/content/
 * categories/{year}.json`, a sibling application that is not part of this
 * repository, so the tasks failed with ENOENT on every run. Configuration
 * now lives in the database and is seeded from `defaultRisingStarCategories`.
 */
export const risingStarCategories = pgTable("rising_star_categories", {
  year: integer("year").primaryKey(),
  /** The full category list, ordered, as JSON. */
  categories: jsonb("categories")
    .$type<RisingStarCategory[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
})

export type RisingStarCategory = {
  key: string
  limit?: number
  count?: number
  tags?: string[]
  excluded?: string[]
  excludedTags?: string[]
  availableComments?: string[]
  guest?: string
  disabled?: boolean
}

/** Computed Rising Stars output, published alongside the JSON artefact. */
export const risingStarProjects = pgTable(
  "rising_star_projects",
  {
    id: text("id").primaryKey(),
    year: integer("year").notNull(),
    fullName: text("full_name").notNull(),
    slug: text("slug"),
    position: smallint("position"),
    category: text("category"),
    starDelta: doublePrecision("star_delta"),
    starCount: integer("star_count"),
    contributorsCount: integer("contributors_count"),
    score: doublePrecision("score"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("rising_star_projects_year_full_name_idx").on(
      table.year,
      table.fullName
    ),
    index("rising_star_projects_year_category_idx").on(
      table.year,
      table.category
    ),
  ]
)

// --- relations -------------------------------------------------------------

export const reposRelations = relations(repos, ({ many }) => ({
  projects: many(projects),
  monthlyStats: many(repoMonthlyStats),
  weeklyStats: many(repoWeeklyStats),
  dailyStats: many(repoDailyStats),
  stargazers: many(repoStargazers),
}))

export const projectsRelations = relations(projects, ({ many, one }) => ({
  repo: one(repos, { fields: [projects.repoId], references: [repos.id] }),
  packages: many(packages),
  skills: many(projectSkills),
  projectsToTags: many(projectsToTags),
  projectsToCapabilities: many(projectsToCapabilities),
  hallOfFameToProjects: many(hallOfFameToProjects),
}))

export const projectsToTagsRelations = relations(projectsToTags, ({ one }) => ({
  project: one(projects, {
    fields: [projectsToTags.projectId],
    references: [projects.id],
  }),
  tag: one(tags, {
    fields: [projectsToTags.tagId],
    references: [tags.id],
  }),
}))

export const capabilitiesRelations = relations(capabilities, ({ many }) => ({
  projectsToCapabilities: many(projectsToCapabilities),
}))

export const projectsToCapabilitiesRelations = relations(
  projectsToCapabilities,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectsToCapabilities.projectId],
      references: [projects.id],
    }),
    capability: one(capabilities, {
      fields: [projectsToCapabilities.capabilityId],
      references: [capabilities.id],
    }),
  })
)

export const repoMonthlyStatsRelations = relations(
  repoMonthlyStats,
  ({ one }) => ({
    repo: one(repos, {
      fields: [repoMonthlyStats.repoId],
      references: [repos.id],
    }),
  })
)

export const repoWeeklyStatsRelations = relations(
  repoWeeklyStats,
  ({ one }) => ({
    repo: one(repos, {
      fields: [repoWeeklyStats.repoId],
      references: [repos.id],
    }),
  })
)

export const repoDailyStatsRelations = relations(
  repoDailyStats,
  ({ one }) => ({
    repo: one(repos, {
      fields: [repoDailyStats.repoId],
      references: [repos.id],
    }),
  })
)

export const repoStargazersRelations = relations(
  repoStargazers,
  ({ one }) => ({
    repo: one(repos, {
      fields: [repoStargazers.repoId],
      references: [repos.id],
    }),
  })
)

export const packagesRelations = relations(packages, ({ one }) => ({
  project: one(projects, {
    fields: [packages.projectId],
    references: [projects.id],
  }),
  bundle: one(bundles, {
    fields: [packages.name],
    references: [bundles.name],
  }),
}))

export const bundlesRelations = relations(bundles, ({ one }) => ({
  package: one(packages, {
    fields: [bundles.name],
    references: [packages.name],
  }),
}))

export const tagsRelations = relations(tags, ({ many }) => ({
  projectsToTags: many(projectsToTags),
}))

export const hallOfFameRelations = relations(hallOfFame, ({ many }) => ({
  hallOfFameToProjects: many(hallOfFameToProjects),
}))

export const hallOfFameToProjectsRelations = relations(
  hallOfFameToProjects,
  ({ one }) => ({
    project: one(projects, {
      fields: [hallOfFameToProjects.projectId],
      references: [projects.id],
    }),
    hallOfFame: one(hallOfFame, {
      fields: [hallOfFameToProjects.username],
      references: [hallOfFame.username],
    }),
  })
)

export const projectSkillsRelations = relations(projectSkills, ({ one }) => ({
  project: one(projects, {
    fields: [projectSkills.projectId],
    references: [projects.id],
  }),
}))

export const projectSyncJobsRelations = relations(
  projectSyncJobs,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectSyncJobs.projectId],
      references: [projects.id],
    }),
    repo: one(repos, {
      fields: [projectSyncJobs.repoId],
      references: [repos.id],
    }),
  })
)

export const readmeSyncJobsRelations = relations(readmeSyncJobs, ({ one }) => ({
  repo: one(repos, {
    fields: [readmeSyncJobs.repoId],
    references: [repos.id],
  }),
}))

export const taskDefinitionsRelations = relations(
  taskDefinitions,
  ({ many, one }) => ({
    executions: many(taskExecutions),
    status: one(taskStatus, {
      fields: [taskDefinitions.id],
      references: [taskStatus.taskDefinitionId],
    }),
  })
)

export const taskExecutionsRelations = relations(taskExecutions, ({ one }) => ({
  taskDefinition: one(taskDefinitions, {
    fields: [taskExecutions.taskDefinitionId],
    references: [taskDefinitions.id],
  }),
}))

export const taskStatusRelations = relations(taskStatus, ({ one }) => ({
  taskDefinition: one(taskDefinitions, {
    fields: [taskStatus.taskDefinitionId],
    references: [taskDefinitions.id],
  }),
}))
