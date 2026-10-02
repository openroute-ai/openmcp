-- Align `catalog_assets` with the visibility rules the application now uses.
--
-- 0007 defined the unified marketplace view with `WHERE status = 'published'`
-- on each branch. That was the whole rule at the time, but P3 splits it into
-- three independent signals (published / not deleted / connection online), and
-- the view is what powers `catalog.search`, `recommendCatalogAssets` and the
-- Store MCP search tool. Left alone it becomes a hole: a provider deletes or
-- disables an MCP server, the asset vanishes from every page, and it is still
-- fully searchable and installable by slug through the MCP tool.
--
-- The view is re-declared in full rather than patched, because `CREATE OR REPLACE
-- VIEW` cannot change the column list of an existing view and the two extra
-- predicates sit inside the per-branch WHERE clauses.

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
-- `deleted_at IS NULL` + `connection_status = 'online'` mirror
-- `web/assets/visibility.ts`. `connection_status` matters because a disabled
-- server still reads as 'published'; without this predicate the catalog keeps
-- offering an endpoint the provider has taken down.
WHERE m.status = 'published'
  AND m.deleted_at IS NULL
  AND m.connection_status = 'online'
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
  AND a.deleted_at IS NULL
  AND a.connection_status = 'online'
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