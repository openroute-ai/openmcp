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
import { createId } from './auth-schema'

/**
 * 用户/作者表
 * 存储工作流的创建者信息
 */
export const authors = pgTable(
  'authors',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    name: varchar('name', { length: 200 }).notNull(), // 作者显示名称
    username: varchar('username', { length: 100 }).notNull().unique(), // 作者用户名，用于URL
    avatar: text('avatar'), // 作者头像，即OSS存储地址
    avatarUrl: text('avatar_url'), // 作者头像URL，即源头头像地址
    description: text('description'), // 作者简介/描述
    bio: text('bio'), // 作者详细简介
    website: text('website'), // 作者网站URL
    twitter: text('twitter'), // Twitter链接
    linkedin: text('linkedin'), // LinkedIn链接
    github: text('github'), // GitHub链接
    verified: boolean('verified').default(false).notNull(), // 是否已验证
    verifiedAt: timestamp('verified_at'), // 验证时间
    verifiedBy: text('verified_by'), // 验证人ID（管理员或审核员）
    verificationNote: text('verification_note'), // 验证备注
    status: varchar('status', {
      length: 20,
      enum: ['active', 'inactive', 'suspended'],
    })
      .default('active')
      .notNull(), // 作者状态
    metadata: jsonb('metadata'), // 额外元数据
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [index('authors_username_idx').on(table.username), index('authors_status_idx').on(table.status)]
)

/**
 * 分类表
 * 存储工作流的分类信息
 */
export const categories = pgTable(
  'categories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar('reference_id', { length: 100 }).unique(), // 分类引用ID，用于唯一标识分类
    name: varchar('name', { length: 100 }).notNull().unique(), // 分类名称，如 "AI", "CRM", "Marketing"
    nameEn: varchar('name_en', { length: 100 }).notNull().unique(), // 分类名称，如 "AI", "CRM", "Marketing"
    slug: varchar('slug', { length: 100 }).notNull().unique(), // 分类标识符，用于URL
    description: text('description'), // 分类描述
    descriptionEn: text('description_en'), // 分类描述英文
    icon: text('icon'), // 分类图标URL
    order: integer('order').default(0), // 排序顺序
    isActive: boolean('is_active').default(true).notNull(), // 是否激活
    metadata: jsonb('metadata'), // 额外元数据
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [index('categories_slug_idx').on(table.slug), index('categories_active_idx').on(table.isActive)]
)

// 用户余额表
/**
 * 用户余额表，用于存储用户余额信息。
 * 用户余额包括账户充值余额、已赠送金额、累计消费金额、累计消费积分、最后同步时间等。
 * 账户总余额，即amountTotal = amount + amountGifted - amountSpend
 * 账户总余额 = 账户充值余额 + 已赠送金额 - 累计消费金额
 */
export const balances = pgTable(
  'balances',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id').notNull(), // 用户ID
    // amount 和 amountGifted 是两个不同的余额，amount 是用户充值的余额，amountGifted 是平台赠送的金额。
    amount: numeric('amount', { precision: 16, scale: 8 }).default('0').notNull(), // 账户充值余额
    credits: numeric('credits', { precision: 10, scale: 2 }).default('0').notNull(), // 用户自行购买的积分
    creditsGifted: numeric('credits_gifted', { precision: 10, scale: 2 }).default('0').notNull(), // 平台赠送的积分
    creditsSpend: numeric('credits_spend', { precision: 10, scale: 2 }).default('0').notNull(), // 累计消费积分
    // 账户总积分，即用户自行购买的积分 + 平台赠送的积分 - 累计消费积分
    creditsTotal: numeric('credits_total', { precision: 10, scale: 2 }).default('0').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('CNY'), // 货币类型
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
    // 账户总余额，即 amount + amountGifted - amountSpend
    amountTotal: numeric('amount_total', { precision: 16, scale: 8 }).default('0').notNull(),
    amountGifted: numeric('amount_gifted', { precision: 16, scale: 8 }).default('0').notNull(), // 已赠送金额
    amountSpend: numeric('amount_spend', { precision: 16, scale: 8 }).default('0').notNull(), // 累计消费金额
    lastSyncAt: timestamp('last_sync_at').default(sql`now()`).notNull(), // 最后同步时间，即与LiteLLMAPI同步的时间
  },
  // UNIQUE, not just an index: every consumer reads a wallet with
  // `where(userId).limit(1)`, and `ensureWallet()` relies on
  // `onConflictDoNothing` to make first-time top-ups idempotent. Both only
  // hold if there is at most one row per user.
  (table) => [uniqueIndex('balances_user_id_unique').on(table.userId)]
)

/**
 * 工作流表
 * 存储工作流的主要信息
 */
export const workflows = pgTable(
  'workflows',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    referenceId: varchar('reference_id', { length: 100 }).notNull().unique(), // 工作流引用ID，用于唯一标识工作流
    slug: varchar('slug', { length: 500 }).notNull().unique(), // URL友好的标识符，如 "pipedrive-tool-mcp-server-all-45-operations-5345"
    title: varchar('title', { length: 500 }).notNull(), // 工作流标题
    titleEn: varchar('title_en', { length: 500 }), // 工作流标题英文
    description: text('description'), // 工作流描述
    descriptionEn: text('description_en'), // 工作流描述英文
    summary: text('summary'), // 工作流简短摘要
    metaDescription: text('meta_description'), // SEO meta description
    authorId: text('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }), // 作者ID
    imageUrl: text('image_url'), // 工作流预览图URL
    workflowUrl: text('workflow_url'), // n8n.io上的工作流URL
    workflowJson: jsonb('workflow_json'), // 工作流的JSON数据
    readme: text('readme'), // 工作流README文档，默认为中文
    readmeEn: text('readme_en'), // 工作流README英文文档
    priceType: varchar('price_type', {
      length: 20,
      enum: ['free', 'paid'],
    })
      .default('free')
      .notNull(), // 价格类型：免费或付费
    priceAmount: decimal('price_amount', { precision: 10, scale: 2 }), // 如果是付费，价格金额
    currency: varchar('currency', { length: 3 }).default('CNY'), // 货币类型
    complexity: varchar('complexity', {
      length: 20,
      enum: ['beginner', 'intermediate', 'advanced'],
    }), // 复杂度：beginner、intermediate、advanced
    certified: boolean('certified').default(false).notNull(), // 是否平台认证
    certifiedAt: timestamp('certified_at'), // 平台认证时间
    certifiedBy: text('certified_by'), // 平台认证人ID（管理员或审核员）
    certificationNote: text('certification_note'), // 平台认证备注
    verificationCount: integer('verification_count').default(0).notNull(), // 用户验证次数
    popularity: integer('popularity').default(0).notNull(), // 热度/流行度评分（用于排序和推荐）
    views: integer('views').default(0).notNull(), // 浏览次数
    downloads: integer('downloads').default(0).notNull(), // 下载次数
    likes: integer('likes').default(0).notNull(), // 点赞次数
    status: varchar('status', {
      length: 20,
      enum: ['draft', 'published', 'archived', 'rejected'],
    })
      .default('draft')
      .notNull(), // 工作流状态
    publishedAt: timestamp('published_at'), // 发布时间
    metadata: jsonb('metadata'), // 额外元数据，如标签等
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('workflows_author_idx').on(table.authorId),
    index('workflows_slug_idx').on(table.slug),
    index('workflows_status_idx').on(table.status),
    index('workflows_price_type_idx').on(table.priceType),
    index('workflows_complexity_idx').on(table.complexity),
    index('workflows_certified_idx').on(table.certified),
    index('workflows_verification_count_idx').on(table.verificationCount),
    index('workflows_popularity_idx').on(table.popularity),
    index('workflows_published_at_idx').on(table.publishedAt),
    index('workflows_views_idx').on(table.views),
    index('workflows_downloads_idx').on(table.downloads),
  ]
)

/**
 * 工作流分类关联表
 * 多对多关系：一个工作流可以属于多个分类
 */
export const workflowCategories = pgTable(
  'workflow_categories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('workflow_category_unique').on(table.workflowId, table.categoryId),
    index('workflow_categories_workflow_idx').on(table.workflowId),
    index('workflow_categories_category_idx').on(table.categoryId),
  ]
)

/**
 * 工作流节点类型表
 * 存储工作流使用的节点类型，用于过滤和搜索
 */
export const workflowNodes = pgTable(
  'workflow_nodes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    nodeType: varchar('node_type', { length: 200 }).notNull(), // 节点类型标识符，如 "n8n-nodes-base.pipedriveTool" 或 "@n8n/n8n-nodes-langchain.mcpTrigger"
    nodeName: varchar('node_name', { length: 200 }), // 节点显示名称（可选），如 "Pipedrive Tool"
    nodeNameEn: varchar('node_name_en', { length: 200 }), // 节点显示名称英文（可选）
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('workflow_nodes_workflow_idx').on(table.workflowId),
    index('workflow_nodes_type_idx').on(table.nodeType),
  ]
)

/**
 * 工作流下载记录表
 * 记录用户下载工作流的历史
 */
export const workflowDownloads = pgTable(
  'workflow_downloads',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: text('user_id'), // 用户ID（如果用户已登录），可为空（匿名下载）
    ipAddress: varchar('ip_address', { length: 45 }), // IP地址，用于统计
    userAgent: text('user_agent'), // 用户代理
    downloadedAt: timestamp('downloaded_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('workflow_downloads_workflow_idx').on(table.workflowId),
    index('workflow_downloads_user_idx').on(table.userId),
    index('workflow_downloads_date_idx').on(table.downloadedAt),
  ]
)

/**
 * 工作流浏览记录表
 * 记录用户浏览工作流的历史
 */
export const workflowViews = pgTable(
  'workflow_views',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: text('user_id'), // 用户ID（如果用户已登录），可为空（匿名浏览）
    ipAddress: varchar('ip_address', { length: 45 }), // IP地址，用于统计
    userAgent: text('user_agent'), // 用户代理
    viewedAt: timestamp('viewed_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('workflow_views_workflow_idx').on(table.workflowId),
    index('workflow_views_user_idx').on(table.userId),
    index('workflow_views_date_idx').on(table.viewedAt),
  ]
)

/**
 * 工作流点赞表
 * 记录用户对工作流的点赞
 */
export const workflowLikes = pgTable(
  'workflow_likes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // 用户ID（必须登录才能点赞）
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('workflow_like_unique').on(table.workflowId, table.userId),
    index('workflow_likes_workflow_idx').on(table.workflowId),
    index('workflow_likes_user_idx').on(table.userId),
  ]
)

/**
 * 工作流收藏表
 * 记录用户收藏的工作流
 */
export const workflowFavorites = pgTable(
  'workflow_favorites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // 用户ID（必须登录才能收藏）
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('workflow_favorite_unique').on(table.workflowId, table.userId),
    index('workflow_favorites_workflow_idx').on(table.workflowId),
    index('workflow_favorites_user_idx').on(table.userId),
  ]
)

/**
 * 工作流评论表
 * 存储用户对工作流的评论
 */
export const workflowComments = pgTable(
  'workflow_comments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // 评论用户ID
    parentId: text('parent_id'), // 父评论ID（用于回复），使用延迟引用避免循环依赖
    content: text('content').notNull(), // 评论内容
    status: varchar('status', {
      length: 20,
      enum: ['published', 'hidden', 'deleted'],
    })
      .default('published')
      .notNull(), // 评论状态
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('workflow_comments_workflow_idx').on(table.workflowId),
    index('workflow_comments_user_idx').on(table.userId),
    index('workflow_comments_parent_idx').on(table.parentId),
    index('workflow_comments_status_idx').on(table.status),
  ]
)

/**
 * 工作流版本表
 * 存储工作流的历史版本（如果需要版本控制）
 */
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    version: varchar('version', { length: 20 }).notNull(), // 版本号，如 "1.0.0"
    workflowJson: jsonb('workflow_json').notNull(), // 该版本的工作流JSON
    changelog: text('changelog'), // 版本更新日志
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    index('workflow_versions_workflow_idx').on(table.workflowId),
    unique('workflow_version_unique').on(table.workflowId, table.version),
  ]
)

/**
 * 工作流用户验证记录表
 * 记录用户在平台上验证工作流的记录
 */
export const workflowVerifications = pgTable(
  'workflow_verifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // 验证用户ID（必须登录才能验证）
    verificationType: varchar('verification_type', {
      length: 20,
      enum: ['successful', 'failed', 'partial'],
    })
      .default('successful')
      .notNull(), // 验证类型：成功、失败、部分成功
    verificationNote: text('verification_note'), // 验证备注（用户填写的验证说明）
    verifiedAt: timestamp('verified_at').default(sql`now()`).notNull(), // 验证时间
    metadata: jsonb('metadata'), // 额外元数据，如验证环境、n8n版本等
    createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  },
  (table) => [
    unique('workflow_verification_unique').on(table.workflowId, table.userId), // 每个用户对每个工作流只能验证一次
    index('workflow_verifications_workflow_idx').on(table.workflowId),
    index('workflow_verifications_user_idx').on(table.userId),
    index('workflow_verifications_type_idx').on(table.verificationType),
    index('workflow_verifications_date_idx').on(table.verifiedAt),
  ]
)

/**
 * 工作流排行表
 * 存储工作流的排行快照数据，支持 Recent 和 Popular 两个维度，以及日/周/月三个周期
 */
export const workflowRankings = pgTable(
  'workflow_rankings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }), // 工作流ID
    dimension: varchar('dimension', {
      length: 20,
      enum: ['recent', 'popular'],
    }).notNull(), // 排行维度：recent（最近）或 popular（流行）
    period: varchar('period', {
      length: 20,
      enum: ['daily', 'weekly', 'monthly'],
    }).notNull(), // 排行周期：daily（日）、weekly（周）、monthly（月）
    date: date('date').notNull(), // 日期，用于日排行（格式：2025-01-13）
    weekStart: date('week_start'), // 周开始日期，用于周排行
    monthStart: date('month_start'), // 月开始日期，用于月排行
    rank: integer('rank').notNull(), // 排名，从1开始
    // Recent 维度指标（时间段内的数据）
    recentViews: integer('recent_views').default(0).notNull(), // 时间段内浏览量
    recentDownloads: integer('recent_downloads').default(0).notNull(), // 时间段内下载量
    recentLikes: integer('recent_likes').default(0).notNull(), // 时间段内点赞数
    recentComments: integer('recent_comments').default(0).notNull(), // 时间段内评论数
    recentVerifications: integer('recent_verifications').default(0).notNull(), // 时间段内验证数
    publishedAt: timestamp('published_at'), // 发布时间，用于排序
    updatedAt: timestamp('updated_at'), // 更新时间，用于排序
    // Popular 维度指标（时间段内的数据）
    popularViews: integer('popular_views').default(0).notNull(), // 时间段内浏览量
    popularDownloads: integer('popular_downloads').default(0).notNull(), // 时间段内下载量
    popularLikes: integer('popular_likes').default(0).notNull(), // 时间段内点赞数
    popularComments: integer('popular_comments').default(0).notNull(), // 时间段内评论数
    popularVerifications: integer('popular_verifications').default(0).notNull(), // 时间段内验证数
    popularityScore: numeric('popularity_score', { precision: 10, scale: 2 }).default('0').notNull(), // 综合热度得分
    // 趋势分析
    previousRank: integer('previous_rank'), // 上一期排名，用于计算趋势
    rankChange: integer('rank_change').default(0).notNull(), // 排名变化，正数上升，负数下降
    trend: varchar('trend', {
      length: 20,
      enum: ['up', 'down', 'stable', 'new'],
    }), // 趋势方向：up（上升）、down（下降）、stable（稳定）、new（新上榜）
    // 元数据
    metadata: jsonb('metadata'), // 额外数据，如增长率等
    calculatedAt: timestamp('calculated_at').default(sql`now()`).notNull(), // 计算时间
    createdAt: timestamp('created_at').default(sql`now()`).notNull(), // 创建时间
  },
  (table) => [
    // 快速查询特定维度和周期的排行
    index('workflow_rankings_dimension_period_date_idx').on(table.dimension, table.period, table.date),
    // 快速查询特定工作流的历史排行
    index('workflow_rankings_workflow_dimension_idx').on(table.workflowId, table.dimension),
    // 按排名查询
    index('workflow_rankings_period_date_rank_idx').on(table.period, table.date, table.rank),
    // 周排行和月排行查询
    index('workflow_rankings_week_idx').on(table.dimension, table.weekStart),
    index('workflow_rankings_month_idx').on(table.dimension, table.monthStart),
    // 唯一约束：同一工作流在同一维度、周期和日期只能有一条记录
    unique('workflow_ranking_unique').on(table.workflowId, table.dimension, table.period, table.date),
  ]
)
