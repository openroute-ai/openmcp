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

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type ProjectType = (typeof PROJECT_TYPES)[number]

/** Tags that must never influence a ranking. */
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
  },
  (table) => [
    uniqueIndex("repos_name_owner_index").on(table.owner, table.name),
    index("repos_pushed_at_idx").on(table.pushedAt),
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
    type: text("type", { enum: PROJECT_TYPES }).notNull().default("application"),
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

export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  aliases: jsonb("aliases").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at"),
})

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
  (table) => [primaryKey({ columns: [table.projectId, table.tagId] })]
)

/**
 * Monthly star history, one row per (repo, year) with the twelve months
 * serialised as JSON. This shape is carried over unchanged: it keeps the
 * table small and the access pattern is always "read the whole year".
 */
export const snapshots = pgTable(
  "snapshots",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    months: jsonb("months").$type<SnapshotMonth[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.year] }),
    index("snapshots_year_idx").on(table.year),
  ]
)

export type SnapshotMonth = {
  month: number
  year: number
  stars: number
  totalDownloads?: number
  totalContributors?: number
  totalPullRequests?: number
  totalReleases?: number
}

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
export const risingStarCategories = pgTable(
  "rising_star_categories",
  {
    year: integer("year").primaryKey(),
    /** The full category list, ordered, as JSON. */
    categories: jsonb("categories")
      .$type<RisingStarCategory[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  }
)

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
  snapshots: many(snapshots),
}))

export const projectsRelations = relations(projects, ({ many, one }) => ({
  repo: one(repos, { fields: [projects.repoId], references: [repos.id] }),
  packages: many(packages),
  skills: many(projectSkills),
  projectsToTags: many(projectsToTags),
  hallOfFameToProjects: many(hallOfFameToProjects),
}))

export const projectsToTagsRelations = relations(
  projectsToTags,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectsToTags.projectId],
      references: [projects.id],
    }),
    tag: one(tags, {
      fields: [projectsToTags.tagId],
      references: [tags.id],
    }),
  })
)

export const snapshotsRelations = relations(snapshots, ({ one }) => ({
  repo: one(repos, { fields: [snapshots.repoId], references: [repos.id] }),
}))

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
  package: one(packages, { fields: [bundles.name], references: [packages.name] }),
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

export const projectSyncJobsRelations = relations(projectSyncJobs, ({ one }) => ({
  project: one(projects, {
    fields: [projectSyncJobs.projectId],
    references: [projects.id],
  }),
  repo: one(repos, {
    fields: [projectSyncJobs.repoId],
    references: [repos.id],
  }),
}))

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
