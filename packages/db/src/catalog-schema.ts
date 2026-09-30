import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgView,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * Unified published marketplace catalog (skills + MCP + A2A + workflows-as-app).
 *
 * Hot score formula (also in migration 0007 comment):
 *   hot_score = ln(1 + downloads) * 2.0
 *             + GREATEST(0, 30 - age_days) * 0.35
 *             + security_weight (safe=8, caution=3, unknown=1, else=0)
 *             + (certified ? 5 : 0)
 *             + (app only) popularity * 0.01
 *
 * Prefer querying via `catalog.search` / Store MCP tools which apply ILIKE +
 * tag/category filters on top of this view (Chinese-friendly, no external FTS).
 */
export const catalogAssets = pgView('catalog_assets', {
  kind: varchar('kind', { length: 20 }).notNull(),
  id: text('id').notNull(),
  slug: varchar('slug', { length: 500 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  categoryId: text('categoryId'),
  priceType: varchar('priceType', { length: 20 }).notNull(),
  securityGrade: varchar('securityGrade', { length: 50 }),
  certified: boolean('certified').notNull(),
  downloads: integer('downloads').notNull(),
  views: integer('views').notNull(),
  publishedAt: timestamp('publishedAt'),
  tags: jsonb('tags').$type<string[] | null>(),
  hotScore: doublePrecision('hotScore').notNull(),
}).existing()
