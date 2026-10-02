-- MCP / A2A purchase entitlements.
--
-- `mcp_servers` and `a2a_agents` have carried `price_type` / `price_amount`
-- columns from the start, but nothing ever read them and there was no table to
-- record a purchase in. The install path (`install_asset` in
-- `apps/web/src/lib/agent-install/store-mcp/tools.ts`) only checked `status`,
-- so a paid MCP or A2A asset was installable by any signed-in user: they got
-- the gateway URL for free. These tables are the missing record, without which
-- a gate could only ever ask "is this free?".
--
-- Two tables rather than one polymorphic `asset_entitlements`: the foreign key
-- has to point at a concrete asset table to be enforced, and a generic
-- `assetId` column can carry no FK at all. Correctness of that column would
-- then rest entirely on application code.
--
-- Column shape mirrors `skill_entitlements` exactly (status, revocation fields,
-- refund audit fields) so the refund and clawback paths share one set of
-- semantics. A refund sets `status = 'revoked'` and keeps the row: deleting it
-- would leave the buyer's order history and the provider's revenue attribution
-- both unable to explain where the money went.

CREATE TABLE IF NOT EXISTS "mcp_server_entitlements" (
    "id" text PRIMARY KEY,
    "user_id" text NOT NULL,
    "mcp_server_id" text NOT NULL,
    "order_id" text,
    "amount" numeric(10, 2) NOT NULL,
    "currency" varchar(3) DEFAULT 'CNY' NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "revoked_at" timestamp,
    "revocation_reason" text,
    "refunded_amount" numeric(10, 2),
    "refunded_at" timestamp,
    "refunded_by" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "mcp_server_entitlement_user_server_unique" UNIQUE ("user_id", "mcp_server_id")
);

CREATE INDEX IF NOT EXISTS "mcp_server_entitlements_user_idx" ON "mcp_server_entitlements" ("user_id");
CREATE INDEX IF NOT EXISTS "mcp_server_entitlements_server_idx" ON "mcp_server_entitlements" ("mcp_server_id");
CREATE INDEX IF NOT EXISTS "mcp_server_entitlements_status_idx" ON "mcp_server_entitlements" ("status");

-- Enum values in Drizzle are only a TS union; nothing stops a hand-written
-- script or a future write that bypasses the schema from storing a typo.
-- `status` decides whether the buyer has access, so a misspelt value would be
-- read as "not active" and silently treated as refunded. Constrain it here.
ALTER TABLE "mcp_server_entitlements"
    DROP CONSTRAINT IF EXISTS "mcp_server_entitlements_status_check";
ALTER TABLE "mcp_server_entitlements"
    ADD CONSTRAINT "mcp_server_entitlements_status_check"
    CHECK ("status" in ('active', 'revoked'));

-- A revoked row must carry a timestamp: `revoked_at` is the only record of when
-- the refund happened, needed both for the 19th auto-confirm and for answering
-- a buyer's "when was I refunded?".
ALTER TABLE "mcp_server_entitlements"
    DROP CONSTRAINT IF EXISTS "mcp_server_entitlements_default_active_check";
ALTER TABLE "mcp_server_entitlements"
    ADD CONSTRAINT "mcp_server_entitlements_default_active_check"
    CHECK ("status" = 'active' or "revoked_at" is not null);

-- A partial refund may not exceed the original amount, or the next refund
-- computes a negative remainder and debits the buyer.
ALTER TABLE "mcp_server_entitlements"
    DROP CONSTRAINT IF EXISTS "mcp_server_entitlements_refunded_not_over_amount_check";
ALTER TABLE "mcp_server_entitlements"
    ADD CONSTRAINT "mcp_server_entitlements_refunded_not_over_amount_check"
    CHECK ("refunded_amount" is null or "refunded_amount" <= "amount");

CREATE TABLE IF NOT EXISTS "a2a_agent_entitlements" (
    "id" text PRIMARY KEY,
    "user_id" text NOT NULL,
    "a2a_agent_id" text NOT NULL,
    "order_id" text,
    "amount" numeric(10, 2) NOT NULL,
    "currency" varchar(3) DEFAULT 'CNY' NOT NULL,
    "status" varchar(20) DEFAULT 'active' NOT NULL,
    "revoked_at" timestamp,
    "revocation_reason" text,
    "refunded_amount" numeric(10, 2),
    "refunded_at" timestamp,
    "refunded_by" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "a2a_agent_entitlement_user_agent_unique" UNIQUE ("user_id", "a2a_agent_id")
);

CREATE INDEX IF NOT EXISTS "a2a_agent_entitlements_user_idx" ON "a2a_agent_entitlements" ("user_id");
CREATE INDEX IF NOT EXISTS "a2a_agent_entitlements_agent_idx" ON "a2a_agent_entitlements" ("a2a_agent_id");
CREATE INDEX IF NOT EXISTS "a2a_agent_entitlements_status_idx" ON "a2a_agent_entitlements" ("status");

ALTER TABLE "a2a_agent_entitlements"
    DROP CONSTRAINT IF EXISTS "a2a_agent_entitlements_status_check";
ALTER TABLE "a2a_agent_entitlements"
    ADD CONSTRAINT "a2a_agent_entitlements_status_check"
    CHECK ("status" in ('active', 'revoked'));

ALTER TABLE "a2a_agent_entitlements"
    DROP CONSTRAINT IF EXISTS "a2a_agent_entitlements_default_active_check";
ALTER TABLE "a2a_agent_entitlements"
    ADD CONSTRAINT "a2a_agent_entitlements_default_active_check"
    CHECK ("status" = 'active' or "revoked_at" is not null);

ALTER TABLE "a2a_agent_entitlements"
    DROP CONSTRAINT IF EXISTS "a2a_agent_entitlements_refunded_not_over_amount_check";
ALTER TABLE "a2a_agent_entitlements"
    ADD CONSTRAINT "a2a_agent_entitlements_refunded_not_over_amount_check"
    CHECK ("refunded_amount" is null or "refunded_amount" <= "amount");

-- Foreign keys to the asset tables. The comment above argues for them, so they
-- have to actually exist: without them a hand-written script could point an
-- entitlement at a `mcp_server_id` that never existed and the row would pass
-- every check in this file.
--
-- `ON DELETE CASCADE`: MCP/A2A removal is a soft delete (the row survives as a
-- tombstone and keeps its slug), so this fires only on a genuine hard delete.
-- An entitlement whose asset is gone is already meaningless, and keeping it
-- would block re-publishing under the same id.
--
-- Added after the CHECK constraints rather than inline in CREATE TABLE so that
-- re-running this file on a database that already has the tables from an
-- earlier pass still converges.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mcp_server_entitlements_server_fk'
    ) THEN
        ALTER TABLE "mcp_server_entitlements"
            ADD CONSTRAINT "mcp_server_entitlements_server_fk"
            FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers" ("id")
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'a2a_agent_entitlements_agent_fk'
    ) THEN
        ALTER TABLE "a2a_agent_entitlements"
            ADD CONSTRAINT "a2a_agent_entitlements_agent_fk"
            FOREIGN KEY ("a2a_agent_id") REFERENCES "a2a_agents" ("id")
            ON DELETE CASCADE;
    END IF;
END $$;
