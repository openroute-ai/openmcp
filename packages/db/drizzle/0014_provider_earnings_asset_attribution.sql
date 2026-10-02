-- Attribute MCP / A2A revenue on `provider_earnings`.
--
-- `provider_earnings` only had `skill_id` (pointing at `skills`) and
-- `gateway_record_id`. One-time MCP/A2A purchases had nowhere to record which
-- asset they came from: the row carried an `author_id` and nothing else, so a
-- provider statement could say "you earned X" but never "from what". Adding the
-- entitlement tables (0013) made the purchase record exist, but the revenue side
-- stayed unattributed.
--
-- Gateway-call revenue had the same blind spot from the other direction: the
-- spend record knew `asset_type` / `asset_name`, but the earning row it produced
-- dropped both and kept only the pointer. Reading the statement therefore meant
-- joining through `gateway_spend_records` to learn anything about the asset.
--
-- `asset_type` + `asset_id` as a pair rather than `mcp_server_id` /
-- `a2a_agent_id` with foreign keys: `provider_earnings` already references
-- tables across several schema modules, and adding two FKs into
-- `registry-schema` (which imports `skills` from this module) would create a
-- cycle. `gateway_spend_records` uses the same `asset_type` / `asset_name`
-- pairing, so this keeps one convention across the money tables.
--
-- Nullable: Skill sales and gateway calls whose asset name could not be resolved
-- both leave it empty. The CHECK constraints below keep that from degrading into
-- half-written attribution.
--
-- No backfill. The platform has not launched, so there is no history to repair;
-- rows written before this migration all predate any MCP/A2A purchase path.

ALTER TABLE "provider_earnings" ADD COLUMN IF NOT EXISTS "asset_type" varchar(20);
ALTER TABLE "provider_earnings" ADD COLUMN IF NOT EXISTS "asset_id" text;

CREATE INDEX IF NOT EXISTS "provider_earnings_asset_idx"
    ON "provider_earnings" ("asset_type", "asset_id");

-- The enum is only a TypeScript union at the schema level. `asset_type` decides
-- which asset table `asset_id` is supposed to point into, and a typo there would
-- make a statement aggregate rows against a table that does not exist.
ALTER TABLE "provider_earnings"
    DROP CONSTRAINT IF EXISTS "provider_earnings_asset_type_check";
ALTER TABLE "provider_earnings"
    ADD CONSTRAINT "provider_earnings_asset_type_check"
    CHECK ("asset_type" is null or "asset_type" in ('mcp', 'a2a'));

-- Attribution must be all-or-nothing. A row with `asset_type` but no `asset_id`
-- is the worst shape: aggregating by asset drops it silently, aggregating by
-- type counts it, and the two totals disagree with no way to find the gap.
ALTER TABLE "provider_earnings"
    DROP CONSTRAINT IF EXISTS "provider_earnings_asset_pair_check";
ALTER TABLE "provider_earnings"
    ADD CONSTRAINT "provider_earnings_asset_pair_check"
    CHECK (("asset_type" is null) = ("asset_id" is null));

-- One row, one source. Carrying both `skill_id` and `asset_id` would leave the
-- statement unable to decide which dimension to aggregate on, or — worse —
-- count the same revenue under both.
ALTER TABLE "provider_earnings"
    DROP CONSTRAINT IF EXISTS "provider_earnings_single_source_check";
ALTER TABLE "provider_earnings"
    ADD CONSTRAINT "provider_earnings_single_source_check"
    CHECK (num_nonnulls("skill_id", "asset_id") <= 1);

-- The same id on the spend record. `asset_name` is already there and stays the
-- authoritative label, but a name is editable: rename `server_name` once and
-- every historical ledger row stops matching its asset. The earnings row built
-- from it reads this column, so "how much did this MCP earn" keeps working
-- across a rename.
--
-- No FK on purpose. A hard delete of an asset must not cascade into the ledger
-- and take financial records with it; the ledger outliving the asset is the
-- intended behaviour. `author_id` already carries `ON DELETE SET NULL` for the
-- same reason.
ALTER TABLE "gateway_spend_records" ADD COLUMN IF NOT EXISTS "asset_id" text;
-- One entitlement, one sale row. Re-running the crediting step after a timeout
-- must not book the same revenue twice.
--
-- This has to be a PARTIAL unique index, not a plain one: a `clawback` row
-- copies `entitlement_id` from the sale row it reverses, so the same
-- entitlement_id legitimately occurs twice (sale + clawback). A plain unique
-- index would make the refund clawback uninsertable — buyer refunded, provider
-- never sees the negative line, and the statement looks like the platform kept
-- the money.
--
-- The `ON CONFLICT (entitlement_id) WHERE kind = 'sale'` used by
-- `creditProviderEarning` / `creditAssetPurchaseEarning` must match this
-- predicate exactly, otherwise Postgres cannot infer an arbiter index and every
-- purchase insert fails with 42P10.
CREATE UNIQUE INDEX IF NOT EXISTS "provider_earnings_entitlement_sale_unique"
    ON "provider_earnings" ("entitlement_id")
    WHERE "kind" = 'sale';
