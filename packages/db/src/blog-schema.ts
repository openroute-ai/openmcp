import { relations } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { createId } from './auth-schema'

/**
 * 博客（教程）表
 *
 * 与工作流市场的 `authors` / `categories` 是两套独立实体，不要混用：
 * 这里存的是文章作者与文章分类，商城那边存的是上架资源的作者与分类。
 *
 * 文章内容以 MDX 字符串存在 `content` 列，由后台的 MDX 编辑器写入，
 * 前台用 `@fumadocs/mdx-remote` 在运行时编译成 React。
 */
export const blogAuthors = pgTable('blog_authors', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  locale: text('locale').notNull().default('zh'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const blogCategories = pgTable('blog_categories', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  locale: text('locale').notNull().default('zh'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const blogPosts = pgTable(
  'blog_posts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // 路径相关。`slugs` 保留历史路径，改 slug 后旧链接仍可命中；
    // `path` 是当前生效的完整路径。
    slug: text('slug').notNull(),
    path: text('path').notNull(),
    slugs: jsonb('slugs').$type<string[]>().notNull(),

    // 内容
    title: text('title').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(), // MDX
    image: text('image').notNull(), // 封面图

    // 元数据
    locale: text('locale').notNull().default('zh'),
    date: timestamp('date').notNull(), // 发布日期
    published: boolean('published').default(true),
    estimatedTime: integer('estimated_time'), // 预计阅读时间（分钟）

    // 关联
    authorId: text('author_id').references(() => blogAuthors.id, { onDelete: 'set null' }),
    /**
     * 分类 ID 数组。刻意用 jsonb 而非关联表：分类只用于筛选，从不需要
     * 反查「某分类下的文章数量」这类聚合，走 GIN 索引的 `@>` 包含查询
     * 比 join 更直接。删除分类不会清理数组里的残留 id，筛选时自然查不到。
     */
    categoryIds: jsonb('category_ids').$type<string[]>().default([]),

    // 时间戳
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // 前台列表按发布时间倒序翻页，这两条索引覆盖该查询。
    index('blog_posts_date_idx').on(table.date),
    index('blog_posts_locale_published_idx').on(table.locale, table.published),
    // jsonb 包含查询需要 GIN 索引，否则按分类筛选会全表扫描。
    index('blog_posts_category_ids_idx').using('gin', table.categoryIds),
  ]
)

export const blogPostsRelations = relations(blogPosts, ({ one }) => ({
  author: one(blogAuthors, {
    fields: [blogPosts.authorId],
    references: [blogAuthors.id],
  }),
}))

export const blogAuthorsRelations = relations(blogAuthors, ({ many }) => ({
  posts: many(blogPosts),
}))

export type BlogPost = typeof blogPosts.$inferSelect
export type NewBlogPost = typeof blogPosts.$inferInsert
export type BlogAuthor = typeof blogAuthors.$inferSelect
export type BlogCategory = typeof blogCategories.$inferSelect
