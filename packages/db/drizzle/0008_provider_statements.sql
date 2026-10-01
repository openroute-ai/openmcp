-- Monthly creator settlement: one statement per author per calendar month per
-- currency. Generation aggregates by `(author_id, currency)` because none of the
-- amount columns records a currency, so summing across two would be meaningless.
-- Billing calendar: the 5th of month M+1 generates the statement for month M,
-- the creator confirms it, and finance transfers the money offline on the 20th
-- and fills in `payout_reference`. A statement whose net plus carryover is
-- negative cannot be paid; it is `rolled` and the shortfall carries forward.

CREATE TABLE "provider_statements" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"period" varchar(7) NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"gross_amount" decimal(10, 2) DEFAULT '0' NOT NULL,
	"platform_fee" decimal(10, 2) DEFAULT '0' NOT NULL,
	"net_amount" decimal(10, 2) DEFAULT '0' NOT NULL,
	"carryover_amount" decimal(10, 2) DEFAULT '0' NOT NULL,
	"settlement" decimal(10, 2) DEFAULT '0' NOT NULL,
	"payable_amount" decimal(10, 2) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"confirmed_by" text,
	"paid_at" timestamp,
	"paid_by" text,
	"payout_reference" text,
	"payout_channel" varchar(20),
	"payout_account" text,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	-- Currency is part of the key because generation aggregates by
	-- `(author_id, currency)` and none of the amount columns carries one:
	-- summing across currencies would produce a number that means nothing.
	CONSTRAINT "provider_statements_author_period_currency_unique" UNIQUE("author_id", "period", "currency")
);
--> statement-breakpoint

CREATE TABLE "provider_statements_author_id_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "provider_statements" ADD CONSTRAINT "provider_statements_status_check"
	CHECK ("status" IN ('pending', 'confirmed', 'paid', 'rolled'));--> statement-breakpoint

CREATE INDEX "provider_statements_author_idx" ON "provider_statements" USING btree ("author_id");
--> statement-breakpoint
CREATE INDEX "provider_statements_status_idx" ON "provider_statements" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "provider_statements_period_idx" ON "provider_statements" USING btree ("period");

--> statement-breakpoint
-- Earnings become settled by belonging to a statement, and a clawback is a
-- negative earnings row rather than a deletion, so both sides of a refund
-- stay visible in the same month's statement.
ALTER TABLE "provider_earnings" ADD COLUMN "statement_id" text;--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD COLUMN "kind" varchar(20) DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD COLUMN "reverses_earning_id" text;--> statement-breakpoint

ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_kind_check"
	CHECK ("kind" IN ('sale', 'clawback'));--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_clawback_negative_check"
	CHECK ("kind" <> 'clawback' OR "net_amount" <= 0);--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "provider_statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_earnings_reverses_earning_unique" ON "provider_earnings" USING btree ("reverses_earning_id");
--> statement-breakpoint
CREATE INDEX "provider_earnings_statement_idx" ON "provider_earnings" USING btree ("statement_id");

--> statement-breakpoint
-- A refunded purchase keeps its row with the access revoked, so the buyer's
-- history and the platform's books can still explain where the money went.
ALTER TABLE "skill_entitlements" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "skill_entitlements" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "skill_entitlements" ADD COLUMN "revocation_reason" text;--> statement-breakpoint
ALTER TABLE "skill_entitlements" ADD COLUMN "refunded_amount" decimal(10, 2);--> statement-breakpoint
ALTER TABLE "skill_entitlements" ADD COLUMN "refunded_at" timestamp;

--> statement-breakpoint
ALTER TABLE "skill_entitlements" ADD CONSTRAINT "skill_entitlements_status_check"
	CHECK ("status" IN ('active', 'revoked'));
--> statement-breakpoint
CREATE INDEX "skill_entitlements_status_idx" ON "skill_entitlements" USING btree ("status");

--> statement-breakpoint
-- Existing rows predate the split: they were all live entitlements, and none
-- of them was ever part of a statement, so they start unattributed.
ALTER TABLE "skill_entitlements" ADD CONSTRAINT "skill_entitlements_default_active_check"
	CHECK ("status" = 'active' OR "revoked_at" IS NOT NULL);