-- Soft delete for MCP servers and A2A agents, plus a NOT NULL on
-- connection_status.
--
-- Why soft delete: `mcp_servers` / `a2a_agents` are referenced by buyer purchase
-- records and by the revenue-share attribution that decides whose statement a
-- gateway spend belongs to. A hard DELETE either trips the FK or cascades the
-- purchase history away, so "who earned this money" stops being answerable just
-- because the provider deleted their listing. The row survives as a tombstone;
-- every read path filters `deleted_at is null`, so it is invisible to the market
-- while remaining available for settlement reconciliation.
--
-- Why NOT NULL on connection_status: the column had `.default('online')` with
-- no NOT NULL, so a row inserted without the column could end up NULL. The
-- listing filter compares `connection_status = 'online'`, and NULL compares to
-- NULL (unknown) rather than true, so such a row would silently disappear from
-- the market with no provider action to explain it.

ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "a2a_agents" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint

-- Market listings always filter `deleted_at is null`; without these indexes the
-- filter degrades into a sequential scan on every browse request.
CREATE INDEX IF NOT EXISTS "mcp_servers_deleted_at_idx" ON "mcp_servers" ("deleted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "a2a_agents_deleted_at_idx" ON "a2a_agents" ("deleted_at");
--> statement-breakpoint

-- Backfill before the NOT NULL: any legacy row with a NULL status would otherwise
-- make this ALTER fail and take the whole migration down.
UPDATE "mcp_servers" SET "connection_status" = 'online' WHERE "connection_status" IS NULL;
--> statement-breakpoint
UPDATE "a2a_agents" SET "connection_status" = 'online' WHERE "connection_status" IS NULL;
--> statement-breakpoint

ALTER TABLE "mcp_servers" ALTER COLUMN "connection_status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "a2a_agents" ALTER COLUMN "connection_status" SET NOT NULL;