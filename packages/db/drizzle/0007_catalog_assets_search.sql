-- Structured marketplace catalog: tags for filter/search + unified catalog_assets view.
-- Hot score (documented for Chat / Store MCP ranking):
--   hot_score = ln(1 + downloads) * 2.0
--             + GREATEST(0, 30 - age_days) * 0.35   -- recency within ~30 days
--             + security_weight (safe=8, caution=3, unknown=1, else=0)
--             + (certified ? 5 : 0)
-- Chinese-friendly search stays ILIKE / tags @> (no Meilisearch in this batch).

ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "a2a_agents" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint

-- Backfill skill tags from features when empty
UPDATE "skills"
SET "tags" = "features"
WHERE ("tags" IS NULL OR "tags" = '[]'::jsonb)
  AND "features" IS NOT NULL
  AND jsonb_typeof("features") = 'array'
  AND jsonb_array_length("features") > 0;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skills_tags_gin_idx" ON "skills" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_servers_tags_gin_idx" ON "mcp_servers" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "a2a_agents_tags_gin_idx" ON "a2a_agents" USING gin ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_tags_gin_idx" ON "workflows" USING gin ("tags");--> statement-breakpoint

CREATE OR REPLACE VIEW "catalog_assets" AS
SELECT
  'skill'::text AS kind,
  s.id,
  s.slug,
  s.title AS title,
  s.description,
  s.category_id AS "categoryId",
  s.price_type AS "priceType",
  s.security_grade AS "securityGrade",
  s.certified,
  s.downloads,
  s.views,
  s.published_at AS "publishedAt",
  COALESCE(s.tags, '[]'::jsonb) AS tags,
  (
    ln(1 + GREATEST(s.downloads, 0)) * 2.0
    + GREATEST(0, 30 - EXTRACT(EPOCH FROM (now() - COALESCE(s.published_at, s.created_at))) / 86400.0) * 0.35
    + CASE COALESCE(s.security_grade, 'unknown')
        WHEN 'safe' THEN 8
        WHEN 'caution' THEN 3
        WHEN 'unknown' THEN 1
        ELSE 0
      END
    + CASE WHEN s.certified THEN 5 ELSE 0 END
  )::double precision AS "hotScore"
FROM skills s
WHERE s.status = 'published'
UNION ALL
SELECT
  'mcp'::text,
  m.id,
  m.slug,
  m.name,
  m.description,
  m.category_id,
  m.price_type,
  COALESCE(m.security_level, 'unknown'),
  m.certified,
  m.downloads,
  m.views,
  m.published_at,
  COALESCE(m.tags, '[]'::jsonb),
  (
    ln(1 + GREATEST(m.downloads, 0)) * 2.0
    + GREATEST(0, 30 - EXTRACT(EPOCH FROM (now() - COALESCE(m.published_at, m.created_at))) / 86400.0) * 0.35
    + CASE lower(COALESCE(m.security_level, 'unknown'))
        WHEN 'safe' THEN 8
        WHEN 'caution' THEN 3
        WHEN 'unknown' THEN 1
        ELSE 0
      END
    + CASE WHEN m.certified THEN 5 ELSE 0 END
  )::double precision
FROM mcp_servers m
WHERE m.status = 'published'
UNION ALL
SELECT
  'a2a'::text,
  a.id,
  a.slug,
  a.name,
  a.description,
  a.category_id,
  a.price_type,
  COALESCE(a.security_level, 'unknown'),
  a.certified,
  a.downloads,
  a.views,
  a.published_at,
  COALESCE(a.tags, '[]'::jsonb),
  (
    ln(1 + GREATEST(a.downloads, 0)) * 2.0
    + GREATEST(0, 30 - EXTRACT(EPOCH FROM (now() - COALESCE(a.published_at, a.created_at))) / 86400.0) * 0.35
    + CASE lower(COALESCE(a.security_level, 'unknown'))
        WHEN 'safe' THEN 8
        WHEN 'caution' THEN 3
        WHEN 'unknown' THEN 1
        ELSE 0
      END
    + CASE WHEN a.certified THEN 5 ELSE 0 END
  )::double precision
FROM a2a_agents a
WHERE a.status = 'published'
UNION ALL
SELECT
  'app'::text,
  w.id,
  w.slug,
  w.title,
  w.description,
  (
    SELECT wc.category_id
    FROM workflow_categories wc
    WHERE wc.workflow_id = w.id
    LIMIT 1
  ),
  w.price_type,
  'unknown'::varchar,
  w.certified,
  w.downloads,
  w.views,
  w.published_at,
  COALESCE(w.tags, '[]'::jsonb),
  (
    ln(1 + GREATEST(w.downloads, 0)) * 2.0
    + GREATEST(0, 30 - EXTRACT(EPOCH FROM (now() - COALESCE(w.published_at, w.created_at))) / 86400.0) * 0.35
    + 1
    + CASE WHEN w.certified THEN 5 ELSE 0 END
    + COALESCE(w.popularity, 0) * 0.01
  )::double precision
FROM workflows w
WHERE w.status = 'published';
