import { sql } from "drizzle-orm"
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
} from "drizzle-orm/pg-core"
import { check } from "drizzle-orm/pg-core/checks"
import { createId, user } from "./auth-schema"
import { skills } from "./mcp-schema"
import { authors, categories } from "./workflow-schema"

/**
 * 提供者入驻表（对接 SkillHub 式三步入驻：认证 → 收款 → 发布）
 * 一个登录用户对应一条入驻记录；authorId 关联到公开作者身份。
 * Batch B: 添加 organizationId 用于企业主体关联 better-auth Organization
 */
export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => authors.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id"),
    entityType: varchar("entity_type", {
      length: 20,
      enum: ["individual", "company"],
    })
      .default("individual")
      .notNull(),
    companyName: varchar("company_name", { length: 200 }),
    contactName: varchar("contact_name", { length: 100 }),
    idNumber: varchar("id_number", { length: 100 }),
    documentationUrl: text("documentation_url"),
    verificationStatus: varchar("verification_status", {
      length: 20,
      enum: ["unverified", "pending", "verified", "rejected"],
    })
      .default("unverified")
      .notNull(),
    verificationNote: text("verification_note"),
    verifiedAt: timestamp("verified_at"),
    payChannelType: varchar("pay_channel_type", {
      length: 20,
      enum: ["none", "wechat", "alipay"],
    })
      .default("none")
      .notNull(),
    payChannelStatus: varchar("pay_channel_status", {
      length: 20,
      enum: ["unconnected", "connecting", "ready", "error"],
    })
      .default("unconnected")
      .notNull(),
    payChannelNote: text("pay_channel_note"),
    agreedTerms: boolean("agreed_terms").default(false).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("provider_profiles_user_unique").on(table.userId),
    index("provider_profiles_author_idx").on(table.authorId),
    index("provider_profiles_verification_idx").on(table.verificationStatus),
    index("provider_profiles_org_idx").on(table.organizationId),
  ]
)

/**
 * MCP Server 注册表
 * 提供者登记的 MCP Server（http/stdio、工具清单、定价、托管方式）
 */
export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar("reference_id", { length: 200 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull().unique(),
    description: text("description"),
    descriptionEn: text("description_en"),
    logoUrl: text("logo_url"),
    coverUrl: text("cover_url"),
    transport: varchar("transport", {
      length: 10,
      enum: ["http", "sse", "stdio"],
    })
      .default("http")
      .notNull(),
    endpoint: text("endpoint"),
    /** 网关标识名（LiteLLM server_name），建议 {providerSlug}__{assetName} */
    serverName: varchar("server_name", { length: 200 }),
    authType: varchar("auth_type", {
      length: 30,
      enum: [
        "none",
        "bearer",
        "api_key",
        "basic",
        "oauth2",
        "platform_oauth",
        "custom",
      ],
    }).default("none"),
    /** 加密后的鉴权配置，永不回显明文 */
    authConfig: jsonb("auth_config"),
    connectionStatus: varchar("connection_status", {
      length: 20,
      enum: ["online", "error", "disabled"],
    })
      .default("online")
      .notNull(),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestResult: jsonb("last_test_result"),
    healthCheckEnabled: boolean("health_check_enabled")
      .default(false)
      .notNull(),
    /**
     * 连续健康检查失败次数。成功即清零。
     *
     * 不能只看单次结果就把 `connectionStatus` 置 error：那一列同时决定市场可见性
     * 和安装门禁，一次超时就会把正常资产踢出市场、创作者收入直接中断。连续计数
     * 让瞬时抖动必须重复出现才生效，而恢复只需一次成功。
     */
    healthFailCount: integer("health_fail_count").default(0).notNull(),
    litellmServerId: varchar("litellm_server_id", { length: 200 }),
    hosting: varchar("hosting", {
      length: 20,
      enum: ["self_hosted", "platform_managed"],
    })
      .default("self_hosted")
      .notNull(),
    scope: varchar("scope", {
      length: 20,
      enum: ["public", "private", "team"],
    })
      .default("public")
      .notNull(),
    tools: jsonb("tools"),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "restrict" }),
    priceType: varchar("price_type", {
      length: 20,
      enum: ["free", "paid"],
    })
      .default("free")
      .notNull(),
    priceAmount: decimal("price_amount", { precision: 10, scale: 2 }),
    billingModel: varchar("billing_model", {
      length: 30,
      enum: ["one_time", "subscription", "pay_per_call"],
    }),
    unitPrice: decimal("unit_price", { precision: 10, scale: 4 }),
    currency: varchar("currency", { length: 3 }).default("CNY"),
    certified: boolean("certified").default(false).notNull(),
    /**
   * 对外展示用的安全等级（`safe` / `caution` / `unsafe` / `unknown`）。
   *
   * 语义上 `unknown` = 从未扫描。**空值不等于安全**：`securityLabelOf` 会把
   * 空值渲染成「未扫描」，避免详情页把没扫过的资产显示成安全。
   */
  securityLevel: varchar("security_level", { length: 50 }),
  /** 规则扫描评级（`lib/security-scan/gateway-scan.ts`），与展示字段分开存 */
  securityGrade: varchar("security_grade", { length: 20 }),
  /** 命中的规则（JSON），与 Skills 的 `security_flags` 同构 */
  securityFlags: jsonb("security_flags"),
  /** LLM 语义复核的补充评级；未复核为 null */
  securityLlmGrade: varchar("security_llm_grade", { length: 20 }),
  /** LLM 复核结论摘要 */
  securityLlmAnalysis: text("security_llm_analysis"),
  /** 最近一次扫描时间 */
  scannedAt: timestamp("scanned_at"),
  /** 扫描所用规则集版本，用于判断历史结果是否需要重扫 */
  scanRulesVersion: varchar("scan_rules_version", { length: 20 }),
  /** 当前在售版本（`gateway_asset_versions.id`）；回滚即改指针 */
  currentVersionId: text("current_version_id"),
  /** 当前在售版本号，冗余一份便于列表展示与排序，不建 FK */
  currentVersion: varchar("current_version", { length: 20 }),
    status: varchar("status", {
      length: 20,
      enum: ["draft", "submitted", "published", "archived", "rejected"],
    })
      .default("draft")
      .notNull(),
    publishedAt: timestamp("published_at"),
    views: integer("views").default(0).notNull(),
    downloads: integer("downloads").default(0).notNull(),
    /** 搜索/筛选标签 */
    tags: jsonb("tags")
      .$type<string[] | null>()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata"),
    /**
     * 软删除时间戳，非空即已删除。
     *
     * 删除保留行而不是 `DELETE`：这张表挂着 `purchases`/`entitlements` 的外键，
     * 硬删要么被 FK 拒绝，要么级联抹掉买家的购买记录 —— 收入归属的原始凭据不能
     * 因为提供方点了删除就消失。
     *
     * 注意这里**不用** `archived` 状态代替删除：`archived` 是提供方主动下架
     * （资产仍然完好、可重新上架），语义和"删除"不同，混用会让恢复上架的入口
     * 判断错。
     */
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("mcp_servers_author_idx").on(table.authorId),
    index("mcp_servers_category_idx").on(table.categoryId),
    index("mcp_servers_status_idx").on(table.status),
    // 市场列表恒定带 `deleted_at is null`，没有这个索引会退化成全表扫。
    index("mcp_servers_deleted_at_idx").on(table.deletedAt),
    index("mcp_servers_transport_idx").on(table.transport),
    unique("mcp_servers_author_server_name_unique").on(
      table.authorId,
      table.serverName
    ),
    index("mcp_servers_litellm_idx").on(table.litellmServerId),
    index("mcp_servers_price_type_idx").on(table.priceType),
    index("mcp_servers_billing_model_idx").on(table.billingModel),
    index("mcp_servers_tags_gin_idx").using("gin", table.tags),
    /** 审核队列按扫描评级筛选（只看未删除资产） */
    index("mcp_servers_security_grade_idx").on(table.securityGrade)
  ]
)

/**
 * 网关资产发布版本（MCP Server / A2A Agent 共用）。
 *
 * Skills 走 `skill_versions`（含源码快照，因为内容接入拿得到文件）。端点接入
 * 拿不到对方代码，能快照的只有**平台侧声明的元数据**：端点、传输方式、工具列表、
 * 价格。这些字段恰好是买家实际依赖的东西——端点一改、工具一删、定价一调，
 * 都会让"我买到的到底是什么"变得无法回答。
 *
 * 所以这里的 snapshot 不是代码备份，而是**一次发布行为的契约快照**：
 *
 * - `mcp_servers.current_version_id` / `a2a_agents.current_version_id` 指向
 *   当前在售版本，回滚 = 把指针指回去。
 * - yank 只下线某个版本，不影响其他版本；已购用户仍可看到自己买到的是哪一版。
 * - 不建 FK 到 `mcp_servers` / `a2a_agents`：资产硬删除后版本记录要留下来，
 *   否则账本和授权会指向一个已经消失的版本。
 */
export const gatewayAssetVersions = pgTable(
  'gateway_asset_versions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    /** 'mcp' | 'a2a' */
    assetType: varchar('asset_type', { length: 20, enum: ['mcp', 'a2a'] }).notNull(),
    /** 对应资产表主键（不建 FK，理由见上） */
    assetId: text('asset_id').notNull(),
    /** 语义化版本号字符串（如 "1.2.0"） */
    version: varchar('version', { length: 20 }).notNull(),
    /** 发布状态；yank 表示发现问题被下线 */
    status: varchar('status', {
      length: 20,
      enum: ['draft', 'published', 'yanked', 'archived'],
    })
      .default('draft')
      .notNull(),
    /** 端点 / 传输 / 工具 / 价格等平台侧元数据快照 */
    snapshot: jsonb('snapshot')
      .$type<{
        name?: string
        description?: string | null
        endpoint?: string | null
        transport?: string | null
        authType?: string | null
        tools?: unknown
        priceType?: string | null
        billingModel?: string | null
        priceAmount?: string | null
        unitPrice?: string | null
        protocolVersion?: string | null
      } | null>(),
    changelog: text('changelog'),
    publishedAt: timestamp('published_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** 该版本发布时的扫描评级，便于回答"我买的那版当时扫出来是什么" */
    securityGrade: varchar('security_grade', { length: 20 }),
    securityScannedAt: timestamp('security_scanned_at'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('gateway_asset_versions_asset_version_unique').on(table.assetType, table.assetId, table.version),
    index('gateway_asset_versions_asset_idx').on(table.assetType, table.assetId),
    index('gateway_asset_versions_status_idx').on(table.status),
  ]
)

export type GatewayAssetVersion = typeof gatewayAssetVersions.$inferSelect
export type NewGatewayAssetVersion = typeof gatewayAssetVersions.$inferInsert

/**
 * A2A Agent 注册表（Agent Card）
 * 提供者登记的智能体服务：A2A endpoint + Agent Card JSON
 */
export const a2aAgents = pgTable(
  "a2a_agents",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar("reference_id", { length: 200 }).notNull().unique(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull().unique(),
    description: text("description"),
    descriptionEn: text("description_en"),
    logoUrl: text("logo_url"),
    coverUrl: text("cover_url"),
    agentCardUrl: text("agent_card_url"),
    agentCard: jsonb("agent_card"),
    /** 上游调用 URL */
    endpoint: text("endpoint"),
    /** 网关标识名（LiteLLM agent_name），建议 {providerSlug}__{assetName} */
    agentName: varchar("agent_name", { length: 200 }),
    protocolVersion: varchar("protocol_version", {
      length: 10,
      enum: ["0.3", "1.0"],
    }).default("1.0"),
    authType: varchar("auth_type", {
      length: 30,
      enum: [
        "none",
        "bearer",
        "api_key",
        "basic",
        "oauth2",
        "platform_oauth",
        "custom",
      ],
    })
      .default("none")
      .notNull(),
    authConfig: jsonb("auth_config"),
    connectionStatus: varchar("connection_status", {
      length: 20,
      enum: ["online", "error", "disabled"],
    })
      .default("online")
      .notNull(),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestResult: jsonb("last_test_result"),
    healthCheckEnabled: boolean("health_check_enabled")
      .default(false)
      .notNull(),
    /**
     * 连续健康检查失败次数。成功即清零。
     *
     * 不能只看单次结果就把 `connectionStatus` 置 error：那一列同时决定市场可见性
     * 和安装门禁，一次超时就会把正常资产踢出市场、创作者收入直接中断。连续计数
     * 让瞬时抖动必须重复出现才生效，而恢复只需一次成功。
     */
    healthFailCount: integer("health_fail_count").default(0).notNull(),
    litellmAgentId: varchar("litellm_agent_id", { length: 200 }),
    visibility: varchar("visibility", {
      length: 20,
      enum: ["public", "private", "team"],
    }).default("public"),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "restrict" }),
    priceType: varchar("price_type", {
      length: 20,
      enum: ["free", "paid"],
    })
      .default("free")
      .notNull(),
    priceAmount: decimal("price_amount", { precision: 10, scale: 2 }),
    billingModel: varchar("billing_model", {
      length: 30,
      enum: ["one_time", "subscription", "pay_per_call"],
    }),
    unitPrice: decimal("unit_price", { precision: 10, scale: 4 }),
    currency: varchar("currency", { length: 3 }).default("CNY"),
    certified: boolean("certified").default(false).notNull(),
    /**
   * 对外展示用的安全等级（`safe` / `caution` / `unsafe` / `unknown`）。
   *
   * 语义上 `unknown` = 从未扫描。**空值不等于安全**：`securityLabelOf` 会把
   * 空值渲染成「未扫描」，避免详情页把没扫过的资产显示成安全。
   */
  securityLevel: varchar("security_level", { length: 50 }),
  /** 规则扫描评级（`lib/security-scan/gateway-scan.ts`），与展示字段分开存 */
  securityGrade: varchar("security_grade", { length: 20 }),
  /** 命中的规则（JSON），与 Skills 的 `security_flags` 同构 */
  securityFlags: jsonb("security_flags"),
  /** LLM 语义复核的补充评级；未复核为 null */
  securityLlmGrade: varchar("security_llm_grade", { length: 20 }),
  /** LLM 复核结论摘要 */
  securityLlmAnalysis: text("security_llm_analysis"),
  /** 最近一次扫描时间 */
  scannedAt: timestamp("scanned_at"),
  /** 扫描所用规则集版本，用于判断历史结果是否需要重扫 */
  scanRulesVersion: varchar("scan_rules_version", { length: 20 }),
  /** 当前在售版本（`gateway_asset_versions.id`）；回滚即改指针 */
  currentVersionId: text("current_version_id"),
  /** 当前在售版本号，冗余一份便于列表展示与排序，不建 FK */
  currentVersion: varchar("current_version", { length: 20 }),
    status: varchar("status", {
      length: 20,
      enum: ["draft", "submitted", "published", "archived", "rejected"],
    })
      .default("draft")
      .notNull(),
    publishedAt: timestamp("published_at"),
    views: integer("views").default(0).notNull(),
    downloads: integer("downloads").default(0).notNull(),
    /** 搜索/筛选标签 */
    tags: jsonb("tags")
      .$type<string[] | null>()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb("metadata"),
    /** 见 `mcpServers.deletedAt`：软删除以保住买家的购买记录与收入归属。 */
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("a2a_agents_author_idx").on(table.authorId),
    index("a2a_agents_category_idx").on(table.categoryId),
    index("a2a_agents_status_idx").on(table.status),
    index("a2a_agents_deleted_at_idx").on(table.deletedAt),
    unique("a2a_agents_author_agent_name_unique").on(
      table.authorId,
      table.agentName
    ),
    index("a2a_agents_litellm_idx").on(table.litellmAgentId),
    index("a2a_agents_price_type_idx").on(table.priceType),
    index("a2a_agents_billing_model_idx").on(table.billingModel),
    index("a2a_agents_tags_gin_idx").using("gin", table.tags),
    /** 审核队列按扫描评级筛选（只看未删除资产） */
    index("a2a_agents_security_grade_idx").on(table.securityGrade)
  ]
)

/**
 * Skill 人工/自动审核记录
 */
export const skillReviews = pgTable(
  "skill_reviews",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    reviewType: varchar("review_type", {
      length: 20,
      enum: ["auto_reject", "manual"],
    }).notNull(),
    reviewerId: text("reviewer_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decision: varchar("decision", {
      length: 20,
      enum: ["pass", "reject", "needs_revision"],
    }),
    reviewComment: text("review_comment"),
    flaggedFlags: jsonb("flagged_flags"),
    scanRulesVersion: varchar("scan_rules_version", { length: 50 }),
    scanGrade: varchar("scan_grade", { length: 20 }),
    llmGrade: varchar("llm_grade", { length: 20 }),
    durationMinutes: integer("duration_minutes"),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("skill_reviews_skill_idx").on(table.skillId),
    index("skill_reviews_reviewer_idx").on(table.reviewerId),
    index("skill_reviews_decision_idx").on(table.decision),
    index("skill_reviews_type_idx").on(table.reviewType),
    index("skill_reviews_created_at_idx").on(table.createdAt),
  ]
)

/**
 * Skill 审核分配
 */
export const skillReviewAssignments = pgTable(
  "skill_review_assignments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    assignedTo: text("assigned_to")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at")
      .default(sql`now()`)
      .notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "completed", "reassigned"],
    })
      .default("pending")
      .notNull(),
  },
  (table) => [
    index("skill_review_assignments_skill_idx").on(table.skillId),
    index("skill_review_assignments_to_idx").on(table.assignedTo),
    index("skill_review_assignments_status_idx").on(table.status),
  ]
)

/**
 * Skill 历次扫描快照
 */
export const skillScans = pgTable(
  "skill_scans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    grade: varchar("grade", { length: 20 }).notNull(),
    llmGrade: varchar("llm_grade", { length: 20 }),
    flags: jsonb("flags"),
    llmAnalysis: jsonb("llm_analysis"),
    trustTier: integer("trust_tier"),
    rulesVersion: varchar("rules_version", { length: 50 }),
    fileCount: integer("file_count").default(0).notNull(),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("skill_scans_skill_idx").on(table.skillId),
    index("skill_scans_created_at_idx").on(table.createdAt),
  ]
)

/**
 * 站内通知
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 50 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    read: boolean("read").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_read_idx").on(table.userId, table.read),
    index("notifications_created_at_idx").on(table.createdAt),
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
  "provider_daily_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    date: date("date", { mode: "date" }).notNull(),
    assetType: varchar("asset_type", {
      length: 20,
      enum: ["mcp", "a2a"],
    }).notNull(),
    calls: integer("calls").default(0).notNull(),
    tokens: bigint("tokens", { mode: "number" }).default(0).notNull(),
    spend: decimal("spend", { precision: 16, scale: 6 }).default("0").notNull(),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    unique("provider_daily_usage_author_date_type_unique").on(
      table.authorId,
      table.date,
      table.assetType
    ),
    index("provider_daily_usage_author_idx").on(table.authorId),
    index("provider_daily_usage_date_idx").on(table.date),
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
  "provider_kyc_submissions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id"),
    entityType: varchar("entity_type", {
      length: 20,
      enum: ["individual", "company"],
    }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "verified", "rejected", "superseded"],
    })
      .default("pending")
      .notNull(),
    payload: jsonb("payload").notNull(),
    verificationNote: text("verification_note"),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at"),
    supersedesId: text("supersedes_id").references(
      (): any => providerKycSubmissions.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at")
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at")
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("provider_kyc_submissions_user_idx").on(table.userId),
    index("provider_kyc_submissions_org_idx").on(table.organizationId),
    index("provider_kyc_submissions_status_idx").on(table.status),
    index("provider_kyc_submissions_created_at_idx").on(table.createdAt),
  ]
)

/**
 * MCP / A2A 购买授权。
 *
 * 之前 `mcp_servers` / `a2a_agents` 上只有 `price_type` / `price_amount` 两列，
 * 没有任何地方校验它，也没有对应的授权表 —— 于是 MCP/A2A 资产实际上无法
 * 收费：安装路径（`store-mcp/tools.ts` 的 `install_asset`）只看 `status`，
 * 一个标了 `paid` 的 MCP 任何登录用户都能直接装走并拿到 gatewayUrl。
 *
 * 用两张表而不是一张 `asset_entitlements`：外键要能指向具体资产表才能保证
 * 引用完整性，一张带 `assetId` 泛型列的表没法建外键，只能靠应用层保证。
 *
 * 定义放在 `registry-schema.ts` 而不是这里：`mcp_servers` / `a2a_agents` 在那边，
 * 而 `registry-schema` 已经 import 了本文件的 `skills`。反过来在��里 import
 * 资产表会形成循环依赖，靠外键闭包的求值时机侥幸工作。
 *
 * 字段与 `skill_entitlements` 保持一致（status/revoked/refund 审计字段），
 * 退款与 clawback 逻辑可以直接复用同一套语义。
 */
export const mcpServerEntitlements = pgTable(
  'mcp_server_entitlements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id').notNull(),
    mcpServerId: text('mcp_server_id')
      .notNull()
      // `ON DELETE CASCADE`：MCP 是软删除（打 tombstone），硬删除只发生在
      // 数据清理场景，此时授权行已经没有意义，留着只会挡住重新发布同名资产。
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    orderId: text('order_id'),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    /** 与 skill_entitlements 同义：退款置 revoked，不删行。 */
    status: varchar('status', { length: 20, enum: ['active', 'revoked'] })
      .default('active')
      .notNull(),
    revokedAt: timestamp('revoked_at'),
    revocationReason: text('revocation_reason'),
    refundedAmount: decimal('refunded_amount', { precision: 10, scale: 2 }),
    refundedAt: timestamp('refunded_at'),
    refundedBy: text('refunded_by'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('mcp_server_entitlement_user_server_unique').on(table.userId, table.mcpServerId),
    index('mcp_server_entitlements_user_idx').on(table.userId),
    index('mcp_server_entitlements_server_idx').on(table.mcpServerId),
    index('mcp_server_entitlements_status_idx').on(table.status),
    check('mcp_server_entitlements_status_check', sql`${table.status} in ('active', 'revoked')`),
    check(
      'mcp_server_entitlements_default_active_check',
      sql`${table.status} = 'active' or ${table.revokedAt} is not null`
    ),
    check(
      'mcp_server_entitlements_refunded_not_over_amount_check',
      sql`${table.refundedAmount} is null or ${table.refundedAmount} <= ${table.amount}`
    ),
  ]
)

export type McpServerEntitlement = typeof mcpServerEntitlements.$inferSelect
export type NewMcpServerEntitlement = typeof mcpServerEntitlements.$inferInsert

export const a2aAgentEntitlements = pgTable(
  'a2a_agent_entitlements',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id').notNull(),
    a2aAgentId: text('a2a_agent_id')
      .notNull()
      .references(() => a2aAgents.id, { onDelete: 'cascade' }),
    orderId: text('order_id'),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('CNY').notNull(),
    status: varchar('status', { length: 20, enum: ['active', 'revoked'] })
      .default('active')
      .notNull(),
    revokedAt: timestamp('revoked_at'),
    revocationReason: text('revocation_reason'),
    refundedAmount: decimal('refunded_amount', { precision: 10, scale: 2 }),
    refundedAt: timestamp('refunded_at'),
    refundedBy: text('refunded_by'),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('a2a_agent_entitlement_user_agent_unique').on(table.userId, table.a2aAgentId),
    index('a2a_agent_entitlements_user_idx').on(table.userId),
    index('a2a_agent_entitlements_agent_idx').on(table.a2aAgentId),
    index('a2a_agent_entitlements_status_idx').on(table.status),
    check('a2a_agent_entitlements_status_check', sql`${table.status} in ('active', 'revoked')`),
    check(
      'a2a_agent_entitlements_default_active_check',
      sql`${table.status} = 'active' or ${table.revokedAt} is not null`
    ),
    check(
      'a2a_agent_entitlements_refunded_not_over_amount_check',
      sql`${table.refundedAmount} is null or ${table.refundedAmount} <= ${table.amount}`
    ),
  ]
)

export type A2aAgentEntitlement = typeof a2aAgentEntitlements.$inferSelect
export type NewA2aAgentEntitlement = typeof a2aAgentEntitlements.$inferInsert

export type ProviderKycSubmission = typeof providerKycSubmissions.$inferSelect
export type NewProviderKycSubmission =
  typeof providerKycSubmissions.$inferInsert
