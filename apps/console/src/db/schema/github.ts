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
    type: varchar("type", { length: 20 }).notNull().default("application"),

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
     * admin.
     *
     * One account at most, and deliberately: it records who got here *first*, so
     * a second account submitting the same URL must not overwrite it. Every
     * submission therefore also needs a row of its own, which is what
     * `user_repos` is for. `/console` and `/console/repos/[id]` accept a row
     * when **either** names the account, which is what makes "我的仓库" mean
     * *mine* instead of the whole registry — reading this column alone hides
     * everything submitted through the API.
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

/**
 * The category taxonomy, curated by an admin.
 *
 * One category per project, stored as a column on {@link projects} rather than
 * as a row in a join table: "exactly one" is then a fact about the schema
 * instead of a rule a writer has to remember, and there is no way for two
 * concurrent classifications to both land.
 *
 * Deliberately **not** seeded. A taxonomy that ships with plausible-looking
 * defaults is one nobody edits, because every default looks deliberate. An
 * operator adds the categories that match what this deployment actually tracks,
 * and only then does the classifier have a closed vocabulary to choose from —
 * an empty table means the classifier has nothing to say and says nothing,
 * which is the honest outcome rather than a guess at the operator's taxonomy.
 *
 * `isActive` retires a category without deleting it. Deleting one would drop
 * the assignment column to NULL across every project filed under it, and
 * `ON DELETE SET NULL` is a quieter way to lose a decision than a rename is.
 * A retired category stays readable, so a reviewer can still see what a project
 * used to be filed under and why.
 */
export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    /**
     * Stable slug, and the value the classifier is allowed to answer with.
     *
     * A slug rather than the display name because the name is the part an
     * operator edits: renaming "MCP 服务器" must not invalidate the
     * `category_id` of every project filed under it.
     */
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    /** Whether the classifier may still choose this category. */
    isActive: boolean("is_active").notNull().default(true),
    /** Presentation order in the admin list; not alphabetical, so an operator can group. */
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("categories_is_active_idx").on(table.isActive),
    index("categories_sort_order_idx").on(table.sortOrder),
  ]
)

/**
 * How many capabilities a project may carry, and how few.
 *
 * A floor as well as a ceiling because the number means something: a project
 * with no capabilities is unclassified, and one with fifty has not been
 * narrowed down at all. The band is what makes "3-5" a reviewable claim about a
 * project rather than a count of whatever the model happened to emit, so the
 * classifier prompt states it and the service enforces it.
 */
export const MIN_CAPABILITIES_PER_PROJECT = 3
export const MAX_CAPABILITIES_PER_PROJECT = 5

/**
 * How many tags a project may carry.
 *
 * A ceiling only. Tags come from the repository's own GitHub topics, which are
 * however many the owner set, so the number here is the editor's statement
 * about how much a reader is meant to take in at a glance rather than a
 * property of the data.
 */
export const MAX_TAGS_PER_PROJECT = 3

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
    /**
     * The one category this project belongs to, or NULL while unclassified.
     *
     * `SET NULL` rather than `CASCADE`: deleting a category should not delete
     * the projects filed under it, it should return them to the unclassified
     * state where the classifier and an operator can both see them again.
     */
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    /**
     * The classifier's own confidence in {@link categoryId}, and the sentence
     * it cited for the decision.
     *
     * Same review contract as `tags.confidence` and
     * `projects_to_capabilities.confidence`: the model proposes, an operator
     * confirms. `category_reviewed_at` being NULL is the work queue, not an
     * error — a category applied with no review yet is a pending suggestion
     * that is still worth showing, because the low-confidence unreviewed rows
     * are exactly what a reviewer should be looking at.
     *
     * A project an operator filed by hand has no score, hence nullable: there
     * is no model opinion to record.
     */
    categoryConfidence: doublePrecision("category_confidence"),
    categoryEvidence: text("category_evidence"),
    categoryReviewedAt: timestamp("category_reviewed_at"),
    /**
     * Where this project's skill documents are delivered, and the key they are
     * signed with. Both come from the submitting caller's `callbackUrl` /
     * `callbackSecret` on `POST /api/v1/projects`, and both are per project
     * rather than per deployment: there is no site-wide skills endpoint any
     * more, so a console can serve several submitters at once and each row
     * carries its own address.
     *
     * Stored rather than passed through because delivery outlives the call. The
     * inline push in that request is the fast path; the `push-skills` retry
     * queue and the operator's "retry now" button run later, with no request to
     * read an address from, so the row is the only place it can come from.
     *
     * The secret is plaintext because HMAC signing needs the key itself — a hash
     * would verify nothing. It is therefore as sensitive as the database row it
     * sits in, and it is deliberately absent from `projectCreatedSchema`, so it
     * cannot travel back out through the API. A row can be re-pointed by a
     * later submission of the same repository, which is why the write scope for
     * this endpoint is granted per key and never self-service.
     */
    skillsWebhookUrl: text("skills_webhook_url"),
    skillsWebhookSecret: text("skills_webhook_secret"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("projects_owner_name_unique").on(table.owner, table.name),
    index("projects_repo_id_idx").on(table.repoId),
    index("projects_status_idx").on(table.status),
    index("projects_type_idx").on(table.type),
    // "every project in this category", which is the only direction the
    // taxonomy is read in once it exists.
    index("projects_category_id_idx").on(table.categoryId),
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
 * 年度月度快照 —— **已停写，保留不删**。
 *
 * `0012_repo_stats.sql` 把这张表的历史搬进了 {@link repoMonthlyStats}
 * （月频快照）和 {@link repoWeeklyStats}，正常情况下应当跟着删掉。但生产库里
 * 这张表仍有 748 行，而且 Drizzle 的 `push` 是靠 **schema 声明** 决定
 * 要执行什么 DDL 的：schema 里没有它，`push` 就会把这张表当成"多余的表"，
 * 连带它的数据一起删掉 —— 而**删掉它需要的权限恰恰是 `push` 没有的那一种**
 * （`push` 只会 GRANT，不会 REVOKE，见 schema.ts 顶部关于已声明列的注释）。
 *
 * 所以这里保留的是一个**声明**，不是一套逻辑：
 *
 * - 不恢复任何写入方。`recordCurrentPeriods` 只写三张 stats 表，
 *   `snapshots` 没有任何服务在读或写。
 * - 不恢复任何查询方。历史读取一律走 stats 表。
 * - 唯一的效果是让 `drizzle-kit push` 认得这张表，从而不会提出删除它。
 *
 * 保留而非删除，是因为这 748 行是 `0012` 迁移 SQL 的**输入**：
 * 任何一次重新生成或重放那段 INSERT，都需要这张表还在。
 * 等到确认再也不会有人重放 `0012`、且备份策略已经覆盖它之后，
 * 才可以用一条显式的 `DROP TABLE`（带注释说明为什么是显式的）把它清掉。
 *
 * 月份数组的结构见 `0012` 的 INSERT：`{ year, month, stars, totalContributors,
 * totalDownloads, totalPullRequests, totalReleases, previous* }`。
 * 这里保留 `$type` 注释是为了让读代码的人知道里面装的是什么，
 * 而不是以为那是一个可以随便塞东西的 jsonb。
 */
export const snapshots = pgTable(
  "snapshots",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    /** 快照年份，一仓一年一行。 */
    year: integer("year").notNull(),
    /** 12 个月的数组，每项一个 `MonthSnapshot`，见上方注释。 */
    months: jsonb("months").$type<MonthSnapshot[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.year] }),
    index("snapshots_year_idx").on(table.year),
  ]
)

/**
 * 一行 {@link snapshots.months} 里的一个月度快照。
 *
 * 只为给上面的 `$type` 一个名字，不作为可写的类型使用。
 */
export interface MonthSnapshot {
  year: number
  month: number
  stars: number
  totalContributors: number
  totalDownloads: number
  totalPullRequests: number
  totalReleases: number
  previousContributors: number
  previousDownloads: number
  previousPullRequests: number
  previousReleases: number
}

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
    index("repo_stargazers_starred_at_idx").on(table.repoId, table.starredAt),
  ]
)

/**
 * 异动的种类。
 *
 * 封闭枚举，而不是自由字符串：异动流要按类型筛选、按类型排序、按类型决定用哪套
 * 措辞，而一个自由词的列这三件事都只能近似回答。每加一种都要改这一行、改
 * `lib/radar/rules.ts` 里的判定、改组件上的标签——这是有意的成本，它让「多了一种
 * 信号」必须是一次跨三处的显式决定，而不是一次往 jsonb 里塞字符串。
 *
 * 刻意**没有**的三种（docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md 附录 A）：
 * `maintainer_churn` 需要贡献者的 commit 时间序列，`cve` 需要接 OSV，
 * `rank_slip` 需要物化分类内分位历史。三者的数据源都不在库里，所以它们不能靠
 * 一个枚举值假装可算——枚举里出现一个永远不会被写入的成员，就是给读者一个
 * 「我们会告诉你维护者流失了」却永远不兑现的承诺。
 */
export const ANOMALY_KINDS = [
  "star_cliff",
  "star_acceleration",
  "release_stall",
  "commit_stall",
  "license_change",
] as const

export type AnomalyKind = (typeof ANOMALY_KINDS)[number]

/**
 * 异动的严重度，以及它对项目是好事还是坏事。
 *
 * 与 `kind` 分开，因为两者的读者不同：`kind` 回答「测到了什么」，`severity` 回答
 * 「这件事有多要紧」。`star_acceleration` 与 `star_cliff` 读的是同一段序列、方向
 * 相反，而它们在异动流里必须被分开对待——加速要进「我们也会说」那一栏，用来证明
 * 警报没有滥用（§5.4 红线 3），断崖要进默认视图。把方向编码进 kind 会让这两个
 * 栏目无法只按 severity 筛选。
 *
 * `good` 只给 `star_acceleration` 用。它存在的原因不是好看，而是红线 3：一个只会
 * 报忧的信号站无法证明自己没有过度报警，所以健康项必须和告警项存在同一张表里、
 * 由同一套规则产出。
 */
export const ANOMALY_SEVERITIES = ["down", "risk", "notice", "good"] as const

export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number]

/** 异动是否已被人工判定为误报。 */
export const ANOMALY_STATUSES = ["open", "dismissed"] as const

export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number]

/**
 * 一次异动判定，以及支撑它的原始量。
 *
 * **物化，而不是查询时算。** 三个理由，都不是性能：
 *
 * 1. §5.4 红线 1 是「误报率优先于召回率」。要衡量误报率，就必须能把当时判的那条
 *    和后来人判的「这是误报」放在一起看——即这条记录必须活得比判定过程久。
 * 2. 阈值会调。阈值一改，查询时算出来的历史结论会跟着变，于是「上周我们报了什么」
 *    变成一个没有答案的问题，而这是异动站唯一必须能回答的问题。
 * 3. 四个消费方（异动流、项目详情、落地页首屏、JSON 出口）必须给出同一个答案。
 *    各自算一遍就意味着四份可能不一致的规则实现。
 *
 * 唯一键 `(repo_id, kind, period)` 让重跑幂等：同一个仓库、同一种异动、同一个周期
 * 只留一行，第二次跑是 `ON CONFLICT` 而不是重复推送。
 */
export const repoAnomalies = pgTable(
  "repo_anomalies",
  {
    id: text("id").primaryKey(),

    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),

    /** 测到了什么，见 {@link ANOMALY_KINDS}。 */
    kind: text("kind", { enum: ANOMALY_KINDS }).notNull(),

    /** 有多要紧 / 是好是坏，见 {@link ANOMALY_SEVERITIES}。 */
    severity: text("severity", { enum: ANOMALY_SEVERITIES }).notNull(),

    /**
     * 判定所依据的周期起点，与 stats 表的 `period` 同一套取值（周一 0 点 / 当月
     * 1 日 0 点，`lib/time.ts` 的 `periodInstant`）。
     *
     * 用周期而不是 `detected_at` 做唯一键的一部分：一次判定讲的是「这一周怎么样」，
     * 不是「我们什么时候跑的」。同一种异动在同一周里被检出两次，是同一条结论。
     */
    period: timestamp("period", { withTimezone: true }).notNull(),

    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * 结论本身，一句话，不含数字以外的主语。
     *
     * 写成人读的一句话而不是一个模板片段，是为了让「这条为什么会被判定」和
     * 「这条说了什么」可以分开看：`metric` 回答前者，`title` 回答后者。两者合成
     * 一个字段的话，改措辞就会改掉历史。
     */
    title: text("title").notNull(),

    /**
     * 触发判定的原始量，形状见 {@link MetricPayload}。
     */
    metric: jsonb("metric").$type<MetricPayload>(),

    /**
     * §5.4 红线 2 要求的原始时间轴 / 名单。
     *
     * 「每条异动必须附原始时间轴/名单/commit，不可只给结论」——所以证据与结论存在
     * 同一行里，而不是靠一个能从结论反查出来的查询。证据气泡与证据时间轴渲染的
     * 就是这一列，读它的人不必相信我们概述得对不对，可以自己看那几周的数。
     */
    evidence: jsonb("evidence").$type<EvidencePayload>(),

    /**
     * 这次变化的**绝对规模**，一个可排序的数字。
     *
     * §5.9.4 要求公开异动流按绝对幅度降序，而不是按增速百分比降序，理由写在那里：
     * 一个从 4 星涨到 8 星的项目是 +100%，而它排第一会让整份榜单看起来像是一套排名
     * 系统在排名小基数噪音。要落实这个排序，就必须有一个能跨规则比较的数字。
     *
     * **它只在同一种 `kind` 内部可比。** 断崖的量级是星标的绝对损失，停滞是天数，
     * 两者相加或比较没有意义。所以公开流默认按 `kind` 分组排序，跨组的先后由
     * `severity` 而不是由这个数字决定——否则一个停更 400 天的项目会永远压在一个
     * 掉了 2 万星的项目前面，而读者看不出为什么。
     *
     * 存成列而不是查询时从 jsonb 里算：排序要在数据库里做（要在 limit 之前排），
     * 而 jsonb 上的表达式既不可索引也会随阈值调整而改变历史顺序。
     */
    magnitude: doublePrecision("magnitude").notNull().default(0),

    /**
     * 人工复核结果，见 {@link ANOMALY_STATUSES}。
     *
     * `open` 是待复核而不是「未确认无误」：默认没有人的判断，只有规则的判断。
     * 公开的异动流只读 `open`，所以一条误报被 dismiss 之后就不再出现在读者面前，
     * 而这一行的历史仍然留着——误报率是 §9.2 里要盯的指标，删掉它就没有分母了。
     */
    status: text("status", { enum: ANOMALY_STATUSES })
      .notNull()
      .default("open"),

    dismissedBy: text("dismissed_by"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    /** 为什么判它是误报。没有理由的 dismiss 不给计数，因为那只是关掉一条通知。 */
    dismissReason: text("dismiss_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 幂等写入的依据，见上方关于唯一键的说明。
    uniqueIndex("repo_anomalies_repo_kind_period_idx").on(
      table.repoId,
      table.kind,
      table.period
    ),
    // 异动流的默认查询就是这个形状：某个周期、尚未被 dismiss 的行，按检测时间倒序。
    index("repo_anomalies_open_by_detected_idx").on(
      table.status,
      table.detectedAt
    ),
    // 公开异动流的排序键（§5.9.4）：同一种异动内按绝对幅度降序。`kind` 在前是因为
    // 幅度只在同类内可比，把它放进索引前缀是让这个约束在查询形状里也成立。
    index("repo_anomalies_open_by_kind_magnitude_idx").on(
      table.status,
      table.kind,
      table.magnitude
    ),
    // 项目详情页的时间轴按仓库取全部异动（含已 dismiss 的，用于解释「当时报过什么」）。
    index("repo_anomalies_repo_period_idx").on(table.repoId, table.period),
  ]
)

/**
 * 触发判定的原始量。
 *
 * 刻意存成 jsonb 而不是拉平成若干数值列：每种异动的「原始量」形状不同
 * （断崖是三个周增量，停滞是「距上次发布天数 + 中位间隔」，许可证是两个
 * SPDX 值），拉平要么给每种加一套列，要么把三种塞进同一组语义不同的列里。
 * 这一列只被规则引擎写、被组件读，不参与任何 `WHERE`，所以它不需要索引。
 *
 * `boolean` 在类型里而不是被编码成 0/1，是因为它承载的是**我们对这份数字的
 * 诚实度**：中位间隔是从按周聚合的发布数推出来的近似，把这件事记成
 * `interval_is_approximate: 1` 会让下游把它当成一个参与计算的数字，而它是
 * 一个会改变读法的事实。
 */
export type MetricPayload = Record<string, number | string | boolean | null>

/**
 * 证据时间轴与证据气泡读的那一份原始量。
 *
 * 类型跟 schema 放在一起，因为它是这一列的契约：写它的只有规则引擎，读它的只有
 * 组件，两边共享同一个定义才不会各写各的形状。`series` 刻意是「已格式化好的一行」
 * 而不是结构化计数——它的读者是人，组件要显示的是「第 3 周 +184」这一整句，
 * 而拆成 `{ label, value }` 再拼字符串只会在每处重复一次格式化规则。
 */
export interface EvidencePayload {
  /** 「近 3 周：+184 / +206 / +218」这样的逐期序列。 */
  series?: { label: string; value: string }[]
  /** 「距上次发布 214 天 / 中位间隔 34 天」这样的补充说明。 */
  notes?: string[]
}

/**
 * 一个仓库的许可证变更历史。
 *
 * 补的是 docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md 附录 A 里「许可证变更历史：
 * 只存当前值」这个缺口。`repos.license_spdx_id` 只存**当前**值，所以「这个项目从
 * Apache-2.0 换成了 AGPL-3.0」这件事在库里根本不存在——异动流里最容易被法务卡住的
 * 一类信号，恰恰是唯一一条我们答不出来的。
 *
 * 写入不新增任何 GitHub 请求：`update-github-data` 已经在读 `licenseSpdxId`，
 * 这里只是把「读到的值与上一条不同」这件事记下来。
 */
export const repoLicenseHistory = pgTable(
  "repo_license_history",
  {
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),

    /** SPDX 标识，或 GitHub 给的 `NOASSERTION` / 空值。 */
    license: text("license").notNull(),

    /**
     * 本系统第一次看到这个值的时间，也就是「变更发生在不早于此刻」的上界。
     *
     * 列名是 `observed_at` 而不是 `changed_at`，因为它记的不是变更本身发生的时刻。
     * 仓库信息接口不返回许可证的历史，要拿到真实变更时间只能逐条回溯 commit，那
     * 是一次真正的采集任务，不在「零新增请求」的范围内。所以这一列只能回答「雷达
     * 什么时候发现的」，而组件与文案也必须这么说话——说成「项目于某日改成」就是把
     * 一个上界当成事实，会在一次全量回填之后公开宣称某个三年前的变更是上周发生的。
     *
     * `created_at` 记的是这一行什么时候写进库的，与上一列通常相同但不是同一件事：
     * 回填会重写 `observed_at` 之外的任何东西，而这一列不会。
     */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // 同一个仓库的同一个许可证只留一行：重复观测不是一次变更，而幂等重跑必须是
    // no-op，否则每次全量回填都会凭空造出一串「变更」。
    primaryKey({ columns: [table.repoId, table.license] }),
    // 「这个仓库最近一次换许可证是什么时候」是唯一会问的读法。
    index("repo_license_history_repo_observed_idx").on(
      table.repoId,
      table.observedAt
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
  snapshots: many(snapshots),
  anomalies: many(repoAnomalies),
  licenseHistory: many(repoLicenseHistory),
}))

export const snapshotsRelations = relations(snapshots, ({ one }) => ({
  repo: one(repos, { fields: [snapshots.repoId], references: [repos.id] }),
}))

export const projectsRelations = relations(projects, ({ many, one }) => ({
  repo: one(repos, { fields: [projects.repoId], references: [repos.id] }),
  category: one(categories, {
    fields: [projects.categoryId],
    references: [categories.id],
  }),
  packages: many(packages),
  skills: many(projectSkills),
  projectsToTags: many(projectsToTags),
  projectsToCapabilities: many(projectsToCapabilities),
  hallOfFameToProjects: many(hallOfFameToProjects),
}))

export const categoriesRelations = relations(categories, ({ many }) => ({
  projects: many(projects),
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

export const repoDailyStatsRelations = relations(repoDailyStats, ({ one }) => ({
  repo: one(repos, {
    fields: [repoDailyStats.repoId],
    references: [repos.id],
  }),
}))

export const repoAnomaliesRelations = relations(repoAnomalies, ({ one }) => ({
  repo: one(repos, {
    fields: [repoAnomalies.repoId],
    references: [repos.id],
  }),
}))

export const repoLicenseHistoryRelations = relations(
  repoLicenseHistory,
  ({ one }) => ({
    repo: one(repos, {
      fields: [repoLicenseHistory.repoId],
      references: [repos.id],
    }),
  })
)

export const repoStargazersRelations = relations(repoStargazers, ({ one }) => ({
  repo: one(repos, {
    fields: [repoStargazers.repoId],
    references: [repos.id],
  }),
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
