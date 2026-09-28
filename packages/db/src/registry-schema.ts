import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core'
import { createId, user } from './auth-schema'
import { skills } from './mcp-schema'
import { authors, categories } from './workflow-schema'

/**
 * 提供者入驻表（对接 SkillHub 式三步入驻：认证 → 收款 → 发布）
 * 一个登录用户对应一条入驻记录；authorId 关联到公开作者身份。
 * Batch B: 添加 organizationId 用于企业主体关联 better-auth Organization
 */
export const providerProfiles = pgTable(
  'provider_profiles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => authors.id, { onDelete: 'set null' }),
    organizationId: text('organization_id'),
    entityType: varchar('entity_type', {
      length: 20,
      enum: ['individual', 'company'],
    })
      .default('individual')
      .notNull(),
    companyName: varchar('company_name', { length: 200 }),
    contactName: varchar('contact_name', { length: 100 }),
    idNumber: varchar('id_number', { length: 100 }),
    documentationUrl: text('documentation_url'),
    verificationStatus: varchar('verification_status', {
      length: 20,
      enum: ['unverified', 'pending', 'verified', 'rejected'],
    })
      .default('unverified')
      .notNull(),
    verificationNote: text('verification_note'),
    verifiedAt: timestamp('verified_at'),
    payChannelType: varchar('pay_channel_type', {
      length: 20,
      enum: ['none', 'wechat', 'alipay'],
    })
      .default('none')
      .notNull(),
    payChannelStatus: varchar('pay_channel_status', {
      length: 20,
      enum: ['unconnected', 'connecting', 'ready', 'error'],
    })
      .default('unconnected')
      .notNull(),
    payChannelNote: text('pay_channel_note'),
    agreedTerms: boolean('agreed_terms').default(false).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('provider_profiles_user_unique').on(table.userId),
    index('provider_profiles_author_idx').on(table.authorId),
    index('provider_profiles_verification_idx').on(table.verificationStatus),
    index('provider_profiles_org_idx').on(table.organizationId),
  ]
)

/**
 * MCP Server 注册表
 * 提供者登记的 MCP Server（http/stdio、工具清单、定价、托管方式）
 */
export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar('reference_id', { length: 200 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull().unique(),
    description: text('description'),
    descriptionEn: text('description_en'),
    logoUrl: text('logo_url'),
    coverUrl: text('cover_url'),
    transport: varchar('transport', {
      length: 10,
      enum: ['http', 'sse', 'stdio'],
    })
      .default('http')
      .notNull(),
    endpoint: text('endpoint'),
    /** 网关标识名（LiteLLM server_name），建议 {providerSlug}__{assetName} */
    serverName: varchar('server_name', { length: 200 }),
    authType: varchar('auth_type', {
      length: 30,
      enum: ['none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'],
    }).default('none'),
    /** 加密后的鉴权配置，永不回显明文 */
    authConfig: jsonb('auth_config'),
    connectionStatus: varchar('connection_status', {
      length: 20,
      enum: ['online', 'error', 'disabled'],
    }).default('online'),
    lastTestedAt: timestamp('last_tested_at'),
    lastTestResult: jsonb('last_test_result'),
    healthCheckEnabled: boolean('health_check_enabled').default(false).notNull(),
    litellmServerId: varchar('litellm_server_id', { length: 200 }),
    hosting: varchar('hosting', {
      length: 20,
      enum: ['self_hosted', 'platform_managed'],
    })
      .default('self_hosted')
      .notNull(),
    scope: varchar('scope', {
      length: 20,
      enum: ['public', 'private', 'team'],
    })
      .default('public')
      .notNull(),
    tools: jsonb('tools'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
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
    securityLevel: varchar('security_level', { length: 50 }),
    status: varchar('status', {
      length: 20,
      enum: ['draft', 'submitted', 'published', 'archived', 'rejected'],
    })
      .default('draft')
      .notNull(),
    publishedAt: timestamp('published_at'),
    views: integer('views').default(0).notNull(),
    downloads: integer('downloads').default(0).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('mcp_servers_author_idx').on(table.authorId),
    index('mcp_servers_category_idx').on(table.categoryId),
    index('mcp_servers_status_idx').on(table.status),
    index('mcp_servers_transport_idx').on(table.transport),
    unique('mcp_servers_author_server_name_unique').on(table.authorId, table.serverName),
    index('mcp_servers_litellm_idx').on(table.litellmServerId),
    index('mcp_servers_price_type_idx').on(table.priceType),
    index('mcp_servers_billing_model_idx').on(table.billingModel),
  ]
)

/**
 * A2A Agent 注册表（Agent Card）
 * 提供者登记的智能体服务：A2A endpoint + Agent Card JSON
 */
export const a2aAgents = pgTable(
  'a2a_agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar('reference_id', { length: 200 }).notNull().unique(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull().unique(),
    description: text('description'),
    descriptionEn: text('description_en'),
    logoUrl: text('logo_url'),
    coverUrl: text('cover_url'),
    agentCardUrl: text('agent_card_url'),
    agentCard: jsonb('agent_card'),
    /** 上游调用 URL */
    endpoint: text('endpoint'),
    /** 网关标识名（LiteLLM agent_name），建议 {providerSlug}__{assetName} */
    agentName: varchar('agent_name', { length: 200 }),
    protocolVersion: varchar('protocol_version', {
      length: 10,
      enum: ['0.3', '1.0'],
    }).default('1.0'),
    authType: varchar('auth_type', {
      length: 30,
      enum: ['none', 'bearer', 'api_key', 'basic', 'oauth2', 'platform_oauth', 'custom'],
    })
      .default('none')
      .notNull(),
    authConfig: jsonb('auth_config'),
    connectionStatus: varchar('connection_status', {
      length: 20,
      enum: ['online', 'error', 'disabled'],
    }).default('online'),
    lastTestedAt: timestamp('last_tested_at'),
    lastTestResult: jsonb('last_test_result'),
    healthCheckEnabled: boolean('health_check_enabled').default(false).notNull(),
    litellmAgentId: varchar('litellm_agent_id', { length: 200 }),
    visibility: varchar('visibility', {
      length: 20,
      enum: ['public', 'private', 'team'],
    }).default('public'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
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
    securityLevel: varchar('security_level', { length: 50 }),
    status: varchar('status', {
      length: 20,
      enum: ['draft', 'submitted', 'published', 'archived', 'rejected'],
    })
      .default('draft')
      .notNull(),
    publishedAt: timestamp('published_at'),
    views: integer('views').default(0).notNull(),
    downloads: integer('downloads').default(0).notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('a2a_agents_author_idx').on(table.authorId),
    index('a2a_agents_category_idx').on(table.categoryId),
    index('a2a_agents_status_idx').on(table.status),
    unique('a2a_agents_author_agent_name_unique').on(table.authorId, table.agentName),
    index('a2a_agents_litellm_idx').on(table.litellmAgentId),
    index('a2a_agents_price_type_idx').on(table.priceType),
    index('a2a_agents_billing_model_idx').on(table.billingModel),
  ]
)

/**
 * Skill 人工/自动审核记录
 */
export const skillReviews = pgTable(
  'skill_reviews',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    reviewType: varchar('review_type', {
      length: 20,
      enum: ['auto_reject', 'manual'],
    }).notNull(),
    reviewerId: text('reviewer_id').references(() => user.id, { onDelete: 'set null' }),
    decision: varchar('decision', {
      length: 20,
      enum: ['pass', 'reject', 'needs_revision'],
    }),
    reviewComment: text('review_comment'),
    flaggedFlags: jsonb('flagged_flags'),
    scanRulesVersion: varchar('scan_rules_version', { length: 50 }),
    scanGrade: varchar('scan_grade', { length: 20 }),
    llmGrade: varchar('llm_grade', { length: 20 }),
    durationMinutes: integer('duration_minutes'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('skill_reviews_skill_idx').on(table.skillId),
    index('skill_reviews_reviewer_idx').on(table.reviewerId),
    index('skill_reviews_decision_idx').on(table.decision),
    index('skill_reviews_type_idx').on(table.reviewType),
    index('skill_reviews_created_at_idx').on(table.createdAt),
  ]
)

/**
 * Skill 审核分配
 */
export const skillReviewAssignments = pgTable(
  'skill_review_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    assignedTo: text('assigned_to')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').default(sql`now()`).notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['pending', 'completed', 'reassigned'],
    })
      .default('pending')
      .notNull(),
  },
  (table) => [
    index('skill_review_assignments_skill_idx').on(table.skillId),
    index('skill_review_assignments_to_idx').on(table.assignedTo),
    index('skill_review_assignments_status_idx').on(table.status),
  ]
)

/**
 * Skill 历次扫描快照
 */
export const skillScans = pgTable(
  'skill_scans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    grade: varchar('grade', { length: 20 }).notNull(),
    llmGrade: varchar('llm_grade', { length: 20 }),
    flags: jsonb('flags'),
    llmAnalysis: jsonb('llm_analysis'),
    trustTier: integer('trust_tier'),
    rulesVersion: varchar('rules_version', { length: 50 }),
    fileCount: integer('file_count').default(0).notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [index('skill_scans_skill_idx').on(table.skillId), index('skill_scans_created_at_idx').on(table.createdAt)]
)

/**
 * 站内通知
 */
export const notifications = pgTable(
  'notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body'),
    read: boolean('read').default(false).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).default(sql`now()`).notNull(),
  },
  (table) => [
    index('notifications_user_idx').on(table.userId),
    index('notifications_read_idx').on(table.userId, table.read),
    index('notifications_created_at_idx').on(table.createdAt),
  ]
)

/**
 * 提供者每日用量汇总（定期从 LiteLLM 消费日志同步）
 *
 * 以提供者作者（authorId）为维度，按资产类型（mcp / a2a）与日期汇总：
 * - calls  : 调用次数（来自 LiteLLM spend logs 中匹配到提供者资产的行数）
 * - tokens : 累计令牌数
 * - spend  : 累计消费金额（预估收入，币种与 LiteLLM 报价一致）
 */
export const providerDailyUsage = pgTable(
  'provider_daily_usage',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'date' }).notNull(),
    assetType: varchar('asset_type', {
      length: 20,
      enum: ['mcp', 'a2a'],
    }).notNull(),
    calls: integer('calls').default(0).notNull(),
    tokens: bigint('tokens', { mode: 'number' }).default(0).notNull(),
    spend: decimal('spend', { precision: 16, scale: 6 }).default('0').notNull(),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('provider_daily_usage_author_date_type_unique').on(table.authorId, table.date, table.assetType),
    index('provider_daily_usage_author_idx').on(table.authorId),
    index('provider_daily_usage_date_idx').on(table.date),
  ]
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

/**
 * Batch B: Provider KYC 提交历史记录（不可变审核快照）
 * 每次提交 KYC 资料创建一条新记录，管理员审核更新 status + note。
 * 个人→企业升级时，旧 individual submission 标记为 superseded。
 */
export const providerKycSubmissions = pgTable(
  'provider_kyc_submissions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id'),
    entityType: varchar('entity_type', {
      length: 20,
      enum: ['individual', 'company'],
    }).notNull(),
    status: varchar('status', {
      length: 20,
      enum: ['pending', 'verified', 'rejected', 'superseded'],
    })
      .default('pending')
      .notNull(),
    payload: jsonb('payload').notNull(),
    verificationNote: text('verification_note'),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at'),
    supersedesId: text('supersedes_id').references((): any => providerKycSubmissions.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('provider_kyc_submissions_user_idx').on(table.userId),
    index('provider_kyc_submissions_org_idx').on(table.organizationId),
    index('provider_kyc_submissions_status_idx').on(table.status),
    index('provider_kyc_submissions_created_at_idx').on(table.createdAt),
  ]
)

export type ProviderKycSubmission = typeof providerKycSubmissions.$inferSelect
export type NewProviderKycSubmission = typeof providerKycSubmissions.$inferInsert
