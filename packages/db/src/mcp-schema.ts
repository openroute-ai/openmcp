import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'
import { createId, user } from './auth-schema'
import { authors, categories } from './workflow-schema'


/**
 * github 仓库表
 * 存储仓库的主要信息
 */
export const repos = pgTable(
  "repos",
  {
    id: text("id").primaryKey(),
    // Date of addition to Best of JS
    addedAt: timestamp("added_at").notNull().defaultNow(),
    type: varchar("type", { length: 20, enum: ["skill", "application", "client", "server", "persona", "mcp", "a2a", "tools", "apps"] }).notNull().default("application"),// 仓库类型， skills、personas、mcp、a2a、tools、apps
    // Last update (by the daily task)
    updatedAt: timestamp("updated_at"),
    // From GitHub REST API
    archived: boolean("archived"),
    defaultBranch: text("default_branch"),
    description: text("description"),
    homepage: text("homepage"),
    name: text("name").notNull(),
    owner: text("owner").notNull(),
    ownerId: integer("owner_id").notNull(), // used in GitHub users avatar URLs
    stars: integer("stargazers_count"),
    topics: jsonb("topics"),
    authorId: text("author_id").references(() => authors.id, { onDelete: "set null" }), // 作者ID
    pushedAt: timestamp("pushed_at").notNull(),
    createdAt: timestamp("created_at").notNull(),

    // From GitHub GraphQL API
    lastCommit: timestamp("last_commit"),
    commitCount: integer("commit_count"),

    // From scrapping
    contributorsCount: integer("contributor_count"),

    // New fields from GitHub GraphQL API
    mentionableUsersCount: integer("mentionable_users_count"),
    watchersCount: integer("watchers_count"),
    licenseSpdxId: text("license_spdx_id"),
    pullRequestsCount: integer("pull_requests_count"),
    releasesCount: integer("releases_count"),
    languages: jsonb("languages"),
    openGraphImageUrl: text("open_graph_image_url"),
    usesCustomOpenGraphImage: boolean("uses_custom_open_graph_image"),
    latestReleaseName: text("latest_release_name"),
    latestReleaseTagName: text("latest_release_tag_name"),
    latestReleasePublishedAt: timestamp("latest_release_published_at"),
    latestReleaseUrl: text("latest_release_url"),
    latestReleaseDescription: text("latest_release_description"),
    forks: integer("forks"),

    // 新增字段：README内容和翻译
    readmeContent: text("readme_content"), // 英文README内容
    readmeContentZh: text("readme_content_zh"), // 中文README内容
    descriptionZh: text("description_zh"), // 翻译后的描述
    iconUrl: text("icon_url"), // 上传到OSS的图标URL
    openGraphImageOssUrl: text("open_graph_image_oss_url"), // 上传到OSS的Open Graph图片URL
    latestReleaseDescriptionZh: text("latest_release_description_zh"), // 翻译后的Release Note内容
  },
  (table) => [uniqueIndex("name_owner_index").on(table.owner, table.name)]
);

/**
 * 仓库快照表，用于存储仓库的快照数据。按照年月日存储。即存储的是每天的快照数据。
 */
export const snapshots = pgTable(
  "repo_snapshots",
  {
    id: text("id").primaryKey().notNull().$defaultFn(() => createId()),
    repoId: text("repo_id").notNull().references(() => repos.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at"),
    year: integer("year").notNull(), // 年份，2026年，即写入2026
    day: integer("day").notNull(), // 天数，3月15日，即写入15 
    month: integer("month").notNull(), // 月份，3月，即写入3
    week: integer("week").notNull(), // 周数，第1周，即写入1
    forks: integer("forks"), // 仓库的fork数量
    stars: integer("stars"), // 仓库的star数量
    watchers: integer("watchers"), // 仓库的watcher数量
    openIssues: integer("open_issues"), // 仓库的open issue数量
    subscribers: integer("subscribers"), // 仓库的subscriber数量
    contributors: integer("contributors"), // 仓库的contributor数量
    pullRequests: integer("pull_requests"), // 仓库的pull request数量
    releases: integer("releases"), // 仓库的release数量
    commits: integer("commits"), // 仓库的commit数量
  },
  (table) => [
    index("repo_snapshots_repo_id_idx").on(table.repoId),
    index("repo_snapshots_year_idx").on(table.year),
    unique("repo_snapshots_repo_day_unique").on(table.repoId, table.year, table.month, table.day),
  ]
);

/**
 * MCP 技能包表
 * 一个发布单元对应一个 MCP Server 或等价能力
 */
export const skills = pgTable(
  'skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar('reference_id', { length: 500 }).notNull().unique(),
    slug: varchar('slug', { length: 500 }).notNull().unique(),
    title: varchar('title', { length: 500 }).notNull(),
    titleEn: varchar('title_en', { length: 500 }),
    description: text('description'),
    descriptionEn: text('description_en'),
    summary: text('summary'),
    metaDescription: text('meta_description'),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    imageUrl: text('image_url'),
    readme: text('readme'),
    readmeEn: text('readme_en'),
    /** SKILL.md / webhook 语义版本 */
    version: varchar('version', { length: 100 }),
    /** 特性关键词列表 */
    features: jsonb('features').$type<string[] | null>(),
    /** 典型使用场景说明 */
    scenario: text('scenario'),
    priceType: varchar('price_type', {
      length: 20,
      enum: ['free', 'paid'],
    })
      .default('free')
      .notNull(),
    priceAmount: decimal('price_amount', { precision: 10, scale: 2 }),
    billingModel: varchar('billing_model', {
      length: 30,
      enum: ['one_time', 'subscription', 'pay_per_call'],
    }),
    unitPrice: decimal('unit_price', { precision: 10, scale: 4 }),
    currency: varchar('currency', { length: 3 }).default('CNY'),
    certified: boolean('certified').default(false).notNull(),
    certifiedAt: timestamp('certified_at'),
    certifiedBy: text('certified_by'),
    certificationNote: text('certification_note'),
    securityLevel: varchar('security_level', { length: 50 }),
    /** 规则+LLM 最终评级：safe / caution / unsafe / reject / unknown */
    securityGrade: varchar('security_grade', {
      length: 20,
      enum: ['safe', 'caution', 'unsafe', 'reject', 'unknown'],
    }).default('unknown'),
    /** 命中 flag 详情数组 */
    securityFlags: jsonb('security_flags').$type<unknown[] | null>(),
    securityLlmGrade: varchar('security_llm_grade', { length: 20 }),
    securityLlmAnalysis: jsonb('security_llm_analysis'),
    trustTier: integer('trust_tier'),
    scannedAt: timestamp('scanned_at'),
    scanRulesVersion: varchar('scan_rules_version', { length: 50 }),
    reviewStatus: varchar('review_status', {
      length: 30,
      enum: ['pending_review', 'passed', 'rejected', 'needs_revision'],
    }),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at'),
    reviewComment: text('review_comment'),
    sourceType: varchar('source_type', {
      length: 20,
      enum: ['github', 'zip'],
    }),
    githubUrl: text('github_url'),
    visibility: varchar('visibility', {
      length: 20,
      enum: ['public', 'private', 'team'],
    }).default('public'),
    lastAuditReportUrl: text('last_audit_report_url'),
    verificationCount: integer('verification_count').default(0).notNull(),
    popularity: integer('popularity').default(0).notNull(),
    views: integer('views').default(0).notNull(),
    downloads: integer('downloads').default(0).notNull(),
    likes: integer('likes').default(0).notNull(),
    status: varchar('status', {
      length: 30,
      enum: ['draft', 'published', 'archived', 'rejected', 'pending_review', 'scanning', 'needs_revision'],
    })
      .default('draft')
      .notNull(),
    publishedAt: timestamp('published_at'),
    mcpSchemaVersion: varchar('mcp_schema_version', { length: 50 }),
    requiredPermissions: jsonb('required_permissions'),
    sandboxPassRate: numeric('sandbox_pass_rate', { precision: 5, scale: 4 }),
    lastSandboxAt: timestamp('last_sandbox_at'),
    forkedFromId: text('forked_from_id').references((): any => skills.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata'),
    // 目标运行平台标记：claude-code / codex / pi / opencode / openclaw ...
    // 不同平台技能格式不同（SKILL.md / CLAUDE.md / .codex/skills.md / PI.md 等），用于分发时生成对应安装方式
    platforms: jsonb('platforms').default(sql`'[]'::jsonb`).notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('skills_author_idx').on(table.authorId),
    index('skills_slug_idx').on(table.slug),
    index('skills_status_idx').on(table.status),
    index('skills_category_idx').on(table.categoryId),
    index('skills_price_type_idx').on(table.priceType),
    index('skills_billing_model_idx').on(table.billingModel),
    index('skills_certified_idx').on(table.certified),
    index('skills_security_level_idx').on(table.securityLevel),
    index('skills_security_grade_idx').on(table.securityGrade),
    index('skills_review_status_idx').on(table.reviewStatus),
    index('skills_popularity_idx').on(table.popularity),
    index('skills_published_at_idx').on(table.publishedAt),
    index('skills_forked_from_idx').on(table.forkedFromId),
  ]
)

/**
 * MCP 工具表
 * 从属于 Skill，不设独立分类
 */
export const mcpTools = pgTable(
  'mcp_tools',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    toolName: varchar('tool_name', { length: 200 }).notNull(),
    nameEn: varchar('name_en', { length: 200 }),
    description: text('description'),
    descriptionEn: text('description_en'),
    inputSchema: jsonb('input_schema'),
    outputSchema: jsonb('output_schema'),
    isDeprecated: boolean('is_deprecated').default(false).notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('mcp_tools_skill_tool_unique').on(table.skillId, table.toolName),
    index('mcp_tools_skill_idx').on(table.skillId),
    index('mcp_tools_tool_name_idx').on(table.toolName),
  ]
)

/**
 * 虚拟员工角色表（Personas）
 * 由多 Skill + Prompt/记忆 组成
 */
export const personas = pgTable(
  'personas',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar('reference_id', { length: 100 }).notNull().unique(),
    slug: varchar('slug', { length: 500 }).notNull().unique(),
    title: varchar('title', { length: 500 }).notNull(),
    titleEn: varchar('title_en', { length: 500 }),
    description: text('description'),
    descriptionEn: text('description_en'),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    imageUrl: text('image_url'),
    promptConfig: jsonb('prompt_config'),
    memoryConfig: jsonb('memory_config'),
    deploymentProfile: jsonb('deployment_profile'),
    priceType: varchar('price_type', {
      length: 20,
      enum: ['free', 'paid'],
    })
      .default('free')
      .notNull(),
    priceAmount: decimal('price_amount', { precision: 10, scale: 2 }),
    billingModel: varchar('billing_model', {
      length: 30,
      enum: ['one_time', 'subscription', 'pay_per_call'],
    }),
    unitPrice: decimal('unit_price', { precision: 10, scale: 4 }),
    currency: varchar('currency', { length: 3 }).default('CNY'),
    certified: boolean('certified').default(false).notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['draft', 'published', 'archived', 'rejected'],
    })
      .default('draft')
      .notNull(),
    publishedAt: timestamp('published_at'),
    forkedFromId: text('forked_from_id').references((): any => personas.id, { onDelete: 'set null' }),
    views: integer('views').default(0).notNull(),
    downloads: integer('downloads').default(0).notNull(),
    likes: integer('likes').default(0).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('personas_author_idx').on(table.authorId),
    index('personas_slug_idx').on(table.slug),
    index('personas_status_idx').on(table.status),
    index('personas_category_idx').on(table.categoryId),
    index('personas_price_type_idx').on(table.priceType),
    index('personas_billing_model_idx').on(table.billingModel),
    index('personas_certified_idx').on(table.certified),
    index('personas_published_at_idx').on(table.publishedAt),
    index('personas_forked_from_idx').on(table.forkedFromId),
  ]
)

/**
 * Persona 与 Skill 多对多关联表
 */
export const personaSkills = pgTable(
  'persona_skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    position: integer('position').default(0).notNull(),
    configOverrides: jsonb('config_overrides'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('persona_skill_unique').on(table.personaId, table.skillId),
    index('persona_skills_persona_idx').on(table.personaId),
    index('persona_skills_skill_idx').on(table.skillId),
  ]
)

// --- Skill 行为与排行表 ---

/**
 * Skill 购买授权：用户付费解锁后写入，unique(userId, skillId)
 */
export const skillEntitlements = pgTable(
  'skill_entitlements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id').notNull(),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    orderId: text('order_id'),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('skill_entitlement_user_skill_unique').on(table.userId, table.skillId),
    index('skill_entitlements_user_idx').on(table.userId),
    index('skill_entitlements_skill_idx').on(table.skillId),
  ]
)

export const skillDownloads = pgTable(
  'skill_downloads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    downloadedAt: timestamp('downloaded_at').default(sql`now()`).notNull(),
    // P0: New fields for download tracking
    status: varchar('status', {
      length: 20,
      enum: ['downloaded', 'failed'],
    })
      .default('downloaded')
      .notNull(),
    skillVersion: varchar('skill_version', { length: 100 }),
    skillTitle: varchar('skill_title', { length: 500 }),
    skillSlug: varchar('skill_slug', { length: 500 }),
  },
  (table) => [
    index('skill_downloads_skill_idx').on(table.skillId),
    index('skill_downloads_user_idx').on(table.userId),
    index('skill_downloads_date_idx').on(table.downloadedAt),
    index('skill_downloads_status_idx').on(table.status),
    unique('skill_downloads_user_skill_unique').on(table.userId, table.skillId),
  ]
)

/**
 * P1: Skill Installs - Track user's installed skills
 */
export const skillInstalls = pgTable(
  'skill_installs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    runtime: varchar('runtime', {
      length: 50,
      enum: ['cursor', 'claude-code', 'codex', 'generic'],
    }).notNull(),
    installPath: text('install_path'),
    status: varchar('status', {
      length: 20,
      enum: ['active', 'removed'],
    })
      .default('active')
      .notNull(),
    installedAt: timestamp('installed_at').default(sql`now()`).notNull(),
    lastUsedAt: timestamp('last_used_at'),
    skillVersion: varchar('skill_version', { length: 100 }),
    skillTitle: varchar('skill_title', { length: 500 }),
    skillSlug: varchar('skill_slug', { length: 500 }),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('skill_installs_user_idx').on(table.userId),
    index('skill_installs_skill_idx').on(table.skillId),
    index('skill_installs_runtime_idx').on(table.runtime),
    index('skill_installs_status_idx').on(table.status),
    index('skill_installs_installed_at_idx').on(table.installedAt),
    unique('skill_installs_user_skill_runtime_unique').on(table.userId, table.skillId, table.runtime),
  ]
)

export const skillViews = pgTable(
  'skill_views',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    viewedAt: timestamp('viewed_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('skill_views_skill_idx').on(table.skillId),
    index('skill_views_user_idx').on(table.userId),
    index('skill_views_date_idx').on(table.viewedAt),
  ]
)

export const skillLikes = pgTable(
  'skill_likes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('skill_like_unique').on(table.skillId, table.userId),
    index('skill_likes_skill_idx').on(table.skillId),
    index('skill_likes_user_idx').on(table.userId),
  ]
)

export const skillFavorites = pgTable(
  'skill_favorites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('skill_favorite_unique').on(table.skillId, table.userId),
    index('skill_favorites_skill_idx').on(table.skillId),
    index('skill_favorites_user_idx').on(table.userId),
  ]
)

export const skillComments = pgTable(
  'skill_comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    parentId: text('parent_id'),
    content: text('content').notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['published', 'hidden', 'deleted'],
    })
      .default('published')
      .notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('skill_comments_skill_idx').on(table.skillId),
    index('skill_comments_user_idx').on(table.userId),
    index('skill_comments_parent_idx').on(table.parentId),
    index('skill_comments_status_idx').on(table.status),
  ]
)

export const skillVerifications = pgTable(
  'skill_verifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    verificationType: varchar('verification_type', {
      length: 20,
      enum: ['successful', 'failed', 'partial'],
    })
      .default('successful')
      .notNull(),
    verificationNote: text('verification_note'),
    verifiedAt: timestamp('verified_at').default(sql`now()`).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('skill_verification_unique').on(table.skillId, table.userId),
    index('skill_verifications_skill_idx').on(table.skillId),
    index('skill_verifications_user_idx').on(table.userId),
    index('skill_verifications_type_idx').on(table.verificationType),
    index('skill_verifications_date_idx').on(table.verifiedAt),
  ]
)

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: varchar('version', { length: 20 }).notNull(),
    /** Legacy content field - use sourceFiles for new versions */
    content: jsonb('content').notNull(),
    changelog: text('changelog'),
    /** Version status: draft, published, yanked, archived */
    status: varchar('status', {
      length: 20,
      enum: ['draft', 'published', 'yanked', 'archived'],
    })
      .default('draft')
      .notNull(),
    publishedAt: timestamp('published_at'),
    /** User who created this version */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Snapshot of source files for this version */
    sourceFiles: jsonb('source_files').$type<Array<{ path: string; content: string }> | null>(),
    /** Additional package metadata (title, description, etc) */
    packageMetadata: jsonb('package_metadata').$type<{
      title?: string
      titleEn?: string
      description?: string
      summary?: string
      platforms?: string[]
    } | null>(),
    /** Security scan result for this specific version */
    securityGrade: varchar('security_grade', {
      length: 20,
      enum: ['safe', 'caution', 'unsafe', 'reject', 'unknown'],
    }),
    securityScannedAt: timestamp('security_scanned_at'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('skill_version_unique').on(table.skillId, table.version),
    index('skill_versions_skill_idx').on(table.skillId),
    index('skill_versions_status_idx').on(table.status),
    index('skill_versions_published_at_idx').on(table.publishedAt),
    index('skill_versions_created_by_idx').on(table.createdBy),
  ]
)

export const skillRankings = pgTable(
  'skill_rankings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    dimension: varchar('dimension', {
      length: 20,
      enum: ['recent', 'popular'],
    }).notNull(),
    period: varchar('period', {
      length: 20,
      enum: ['daily', 'weekly', 'monthly'],
    }).notNull(),
    date: date('date').notNull(),
    weekStart: date('week_start'),
    monthStart: date('month_start'),
    rank: integer('rank').notNull(),
    recentViews: integer('recent_views').default(0).notNull(),
    recentDownloads: integer('recent_downloads').default(0).notNull(),
    recentLikes: integer('recent_likes').default(0).notNull(),
    recentComments: integer('recent_comments').default(0).notNull(),
    recentVerifications: integer('recent_verifications').default(0).notNull(),
    publishedAt: timestamp('published_at'),
    updatedAt: timestamp('updated_at'),
    popularViews: integer('popular_views').default(0).notNull(),
    popularDownloads: integer('popular_downloads').default(0).notNull(),
    popularLikes: integer('popular_likes').default(0).notNull(),
    popularComments: integer('popular_comments').default(0).notNull(),
    popularVerifications: integer('popular_verifications').default(0).notNull(),
    popularityScore: numeric('popularity_score', { precision: 10, scale: 2 }).default('0').notNull(),
    previousRank: integer('previous_rank'),
    rankChange: integer('rank_change').default(0).notNull(),
    trend: varchar('trend', {
      length: 20,
      enum: ['up', 'down', 'stable', 'new'],
    }),
    metadata: jsonb('metadata'),
    calculatedAt: timestamp('calculated_at').default(sql`now()`).notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('skill_rankings_dimension_period_date_idx').on(table.dimension, table.period, table.date),
    index('skill_rankings_skill_dimension_idx').on(table.skillId, table.dimension),
    index('skill_rankings_period_date_rank_idx').on(table.period, table.date, table.rank),
    index('skill_rankings_week_idx').on(table.dimension, table.weekStart),
    index('skill_rankings_month_idx').on(table.dimension, table.monthStart),
    unique('skill_ranking_unique').on(table.skillId, table.dimension, table.period, table.date),
  ]
)

// --- Persona 行为、版本与排行表 ---

export const personaDownloads = pgTable(
  'persona_downloads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    downloadedAt: timestamp('downloaded_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('persona_downloads_persona_idx').on(table.personaId),
    index('persona_downloads_user_idx').on(table.userId),
    index('persona_downloads_date_idx').on(table.downloadedAt),
  ]
)

export const personaViews = pgTable(
  'persona_views',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    userId: text('user_id'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    viewedAt: timestamp('viewed_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('persona_views_persona_idx').on(table.personaId),
    index('persona_views_user_idx').on(table.userId),
    index('persona_views_date_idx').on(table.viewedAt),
  ]
)

export const personaLikes = pgTable(
  'persona_likes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('persona_like_unique').on(table.personaId, table.userId),
    index('persona_likes_persona_idx').on(table.personaId),
    index('persona_likes_user_idx').on(table.userId),
  ]
)

export const personaFavorites = pgTable(
  'persona_favorites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('persona_favorite_unique').on(table.personaId, table.userId),
    index('persona_favorites_persona_idx').on(table.personaId),
    index('persona_favorites_user_idx').on(table.userId),
  ]
)

export const personaComments = pgTable(
  'persona_comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    parentId: text('parent_id'),
    content: text('content').notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['published', 'hidden', 'deleted'],
    })
      .default('published')
      .notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('persona_comments_persona_idx').on(table.personaId),
    index('persona_comments_user_idx').on(table.userId),
    index('persona_comments_parent_idx').on(table.parentId),
    index('persona_comments_status_idx').on(table.status),
  ]
)

/**
 * Persona 版本表（必建）
 * 记录每个 Persona 版本的完整可复现快照，含 persona_skills 配置快照
 */
export const personaVersions = pgTable(
  'persona_versions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    version: varchar('version', { length: 20 }).notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changelog: text('changelog'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('persona_version_unique').on(table.personaId, table.version),
    index('persona_versions_persona_idx').on(table.personaId),
    index('persona_versions_created_at_idx').on(table.createdAt),
  ]
)

export const personaRankings = pgTable(
  'persona_rankings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    personaId: text('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    dimension: varchar('dimension', {
      length: 20,
      enum: ['recent', 'popular'],
    }).notNull(),
    period: varchar('period', {
      length: 20,
      enum: ['daily', 'weekly', 'monthly'],
    }).notNull(),
    date: date('date').notNull(),
    weekStart: date('week_start'),
    monthStart: date('month_start'),
    rank: integer('rank').notNull(),
    recentViews: integer('recent_views').default(0).notNull(),
    recentDownloads: integer('recent_downloads').default(0).notNull(),
    recentLikes: integer('recent_likes').default(0).notNull(),
    recentComments: integer('recent_comments').default(0).notNull(),
    publishedAt: timestamp('published_at'),
    updatedAt: timestamp('updated_at'),
    popularViews: integer('popular_views').default(0).notNull(),
    popularDownloads: integer('popular_downloads').default(0).notNull(),
    popularLikes: integer('popular_likes').default(0).notNull(),
    popularComments: integer('popular_comments').default(0).notNull(),
    popularityScore: numeric('popularity_score', { precision: 10, scale: 2 }).default('0').notNull(),
    previousRank: integer('previous_rank'),
    rankChange: integer('rank_change').default(0).notNull(),
    trend: varchar('trend', {
      length: 20,
      enum: ['up', 'down', 'stable', 'new'],
    }),
    metadata: jsonb('metadata'),
    calculatedAt: timestamp('calculated_at').default(sql`now()`).notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('persona_rankings_dimension_period_date_idx').on(table.dimension, table.period, table.date),
    index('persona_rankings_persona_dimension_idx').on(table.personaId, table.dimension),
    index('persona_rankings_period_date_rank_idx').on(table.period, table.date, table.rank),
    index('persona_rankings_week_idx').on(table.dimension, table.weekStart),
    index('persona_rankings_month_idx').on(table.dimension, table.monthStart),
    unique('persona_ranking_unique').on(table.personaId, table.dimension, table.period, table.date),
  ]
)

// --- Provider 结算（Skills 分成 / 提现）---

/** 平台默认分成：Provider 获得 70%，平台抽成 30% */
export const PROVIDER_REVENUE_SHARE = 0.7

/**
 * 网关消费账本：LiteLLM spend logs 的本地幂等副本。
 *
 * Marketplace 的 MCP/A2A 请求由客户端直连 LiteLLM，openmcp 无法拦截调用链，
 * 因此只能在事后从 LiteLLM 拉日志回补扣款。`request_id` 的唯一约束就是幂等
 * 键：同一条消费日志重复同步不会二次扣款。
 *
 * `overspendAmount` 记录余额已扣到 0 之后仍超出预算的部分 —— 留待对账，
 * 不写成负余额。
 */
export const gatewaySpendRecords = pgTable(
  'gateway_spend_records',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    /** LiteLLM 消费日志的请求 ID —— 幂等键 */
    requestId: text('request_id').notNull(),
    /** 消费用户（由 keyAlias 反查 api_keys 得出） */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    apiKeyId: text('api_key_id'),
    keyAlias: text('key_alias'),
    /** 扣款金额（数值直传，不换算） */
    spend: numeric('spend', { precision: 16, scale: 8 }).default('0').notNull(),
    /** 余额被扣到 0 后仍超出预算的部分，留待对账，不写负余额 */
    overspendAmount: numeric('overspend_amount', { precision: 16, scale: 8 }).default('0').notNull(),
    totalTokens: integer('total_tokens').default(0).notNull(),
    /** 命中的资产类型；null 表示该消费未能归属到市场资产 */
    assetType: varchar('asset_type', { length: 20, enum: ['mcp', 'a2a'] }),
    /** LiteLLM model 名，即 server_name / agent_name */
    assetName: text('asset_name'),
    /** Provider 归属，分成用 */
    authorId: text('author_id').references(() => authors.id, { onDelete: 'set null' }),
    model: text('model'),
    /** 消费发生时间（LiteLLM startTime），与 createdAt 区分 */
    occurredAt: timestamp('occurred_at').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('gateway_spend_records_request_id_unique').on(table.requestId),
    index('gateway_spend_records_user_idx').on(table.userId),
    index('gateway_spend_records_author_idx').on(table.authorId),
    index('gateway_spend_records_occurred_at_idx').on(table.occurredAt),
    index('gateway_spend_records_key_alias_idx').on(table.keyAlias),
  ]
)

export type GatewaySpendRecord = typeof gatewaySpendRecords.$inferSelect
export type NewGatewaySpendRecord = typeof gatewaySpendRecords.$inferInsert

export const providerEarnings = pgTable(
  'provider_earnings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    buyerUserId: text('buyer_user_id').notNull(),
    /**
     * Skill 销售分成时指向具体 Skill；MCP / A2A 调用分成为 null。
     * 可空 —— 网关调用没有 Skill 概念。
     */
    skillId: text('skill_id').references(() => skills.id, { onDelete: 'cascade' }),
    /**
     * 网关消费分成时指向该次消费在账本里的行。唯一约束保证同一条消费日志
     * 不会产生两条分成记录 —— 与 `gateway_spend_records.request_id` 的
     * 幂等键配合，重复同步不会把分成算两遍。
     */
    gatewayRecordId: text('gateway_record_id').references(() => gatewaySpendRecords.id, {
      onDelete: 'cascade',
    }),
    entitlementId: text('entitlement_id'),
    grossAmount: decimal('gross_amount', { precision: 10, scale: 2 }).notNull(),
    platformFee: decimal('platform_fee', { precision: 10, scale: 2 }).notNull(),
    netAmount: decimal('net_amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['pending', 'payable', 'paid'],
    })
      .default('payable')
      .notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('provider_earnings_author_idx').on(table.authorId),
    index('provider_earnings_skill_idx').on(table.skillId),
    index('provider_earnings_status_idx').on(table.status),
    index('provider_earnings_created_at_idx').on(table.createdAt),
    unique('provider_earnings_gateway_record_unique').on(table.gatewayRecordId),
  ]
)

export const providerPayoutRequests = pgTable(
  'provider_payout_requests',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['pending', 'approved', 'rejected', 'paid'],
    })
      .default('pending')
      .notNull(),
    payoutChannel: varchar('payout_channel', { length: 20 }),
    payoutAccount: text('payout_account'),
    adminNote: text('admin_note'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('provider_payout_requests_author_idx').on(table.authorId),
    index('provider_payout_requests_user_idx').on(table.userId),
    index('provider_payout_requests_status_idx').on(table.status),
  ]
)
