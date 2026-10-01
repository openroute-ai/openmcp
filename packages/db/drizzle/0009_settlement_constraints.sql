-- Guardrails that 0008 declared in SQL but that never reached the database.
--
-- 0008 was applied with `drizzle-kit push`, which builds DDL from the Drizzle
-- schema and ignores the .sql file entirely. Every CHECK constraint written
-- there was therefore silently dropped: `pg_constraint` had zero rows of
-- `contype = 'c'` on these three tables, and a probe INSERT of a positive
-- `clawback` row with `kind = 'bogus-kind'` succeeded.
--
-- These constraints are now also declared in `mcp-schema.ts`, so push and
-- migrate agree from here on. This migration exists to close the gap on a
-- database that was already pushed.

-- A misspelled status would leave a statement that displays as neither
-- payable nor paid: finance would not see it and the money would sit there.
ALTER TABLE "provider_statements" ADD CONSTRAINT "provider_statements_status_check"
	CHECK ("status" IN ('pending', 'confirmed', 'paid', 'rolled'));
--> statement-breakpoint

-- A `rolled` statement is the marker for "do not pay this period". If it also
-- carried a positive payable_amount, finance would pay out and the same
-- shortfall would be deducted again next month.
ALTER TABLE "provider_statements" ADD CONSTRAINT "provider_statements_rolled_not_payable_check"
	CHECK ("status" <> 'rolled' OR "payable_amount" = 0);
--> statement-breakpoint

-- Carryover is a deficit carried in from the previous period. A positive value
-- would invent money that was never earned.
ALTER TABLE "provider_statements" ADD CONSTRAINT "provider_statements_carryover_sign_check"
	CHECK ("carryover_amount" <= 0);
--> statement-breakpoint

-- A clawback written as positive would raise the month's net income instead of
-- reversing it, so finance would pay out while the platform is out of pocket.
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_kind_check"
	CHECK ("kind" IN ('sale', 'clawback'));
--> statement-breakpoint

ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_clawback_negative_check"
	CHECK ("kind" <> 'clawback' OR "net_amount" <= 0);
--> statement-breakpoint

-- A `reverses_earning_id` on a `sale` row would occupy that value against the
-- unique index, so the genuine clawback reversing the same earning could not
-- be inserted at all.
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_reverses_only_clawback_check"
	CHECK ("kind" <> 'clawback' OR "reverses_earning_id" IS NOT NULL);
--> statement-breakpoint

-- `status` decides whether the buyer has access, so a typo must not be stored.
ALTER TABLE "skill_entitlements" ADD CONSTRAINT "skill_entitlements_status_check"
	CHECK ("status" IN ('active', 'revoked'));
--> statement-breakpoint

-- `revoked_at` is the only record of when the refund happened: the auto-confirm
-- run and "when was I refunded" both depend on it.
ALTER TABLE "skill_entitlements" ADD CONSTRAINT "skill_entitlements_default_active_check"
	CHECK ("status" = 'active' OR "revoked_at" IS NOT NULL);
--> statement-breakpoint

-- A partial refund must never exceed the original amount, or the next refund
-- computes a negative balance and charges the buyer for being refunded.
ALTER TABLE "skill_entitlements" ADD CONSTRAINT "skill_entitlements_refunded_not_over_amount_check"
	CHECK ("refunded_amount" IS NULL OR "refunded_amount" <= "amount");
--> statement-breakpoint

-- A refund moves real money out of the platform. Without "who authorised it"
-- there is no way to answer a buyer's complaint or to hold anyone accountable,
-- so it is recorded here until the general audit log lands in P4.
ALTER TABLE "skill_entitlements" ADD COLUMN "refunded_by" text;