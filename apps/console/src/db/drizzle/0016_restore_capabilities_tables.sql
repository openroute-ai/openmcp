-- Restores `capabilities` and `projects_to_capabilities` on databases that are
-- missing them.
--
-- How this drift appeared:
--
--   `0000_console_baseline.sql` creates both tables, and the 0013-0015 snapshots
--   carry them, so every declaration in `src/db/schema/github.ts` expects them to
--   exist. The live database was nevertheless built from an *earlier* revision of
--   `0000`, before commit f4ce83c folded the capability tables into the baseline.
--   Its ledger row still carries that older revision's timestamp, which is why
--   `drizzle-kit migrate` believes `0000` has not run yet.
--
-- Why a forward migration is the only fix:
--
--   Drizzle applies a migration when the ledger's newest `created_at` is smaller
--   than the migration's folder timestamp, and the ledger row can only be moved
--   forward. `0000` is stamped as applied so the baseline is not replayed, which
--   also means it can never create these tables. Anything the live database is
--   missing relative to `0000` has to be re-issued as a new file.
--
-- This migration is additive and idempotent:
--
--   - `CREATE TABLE IF NOT EXISTS` leaves an existing table and its rows alone.
--   - Foreign keys and indexes are added only when absent, so running this on a
--     database that already has them is a no-op.
--   - It never drops, truncates or rewrites anything.
--
-- The DDL is copied verbatim from `0000_console_baseline.sql` so the live schema
-- matches the baseline exactly rather than drifting toward an approximation.
CREATE TABLE IF NOT EXISTS "capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"axis" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"confidence" double precision,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects_to_capabilities" (
	"project_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"evidence" text,
	"confidence" double precision,
	"rejected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_to_capabilities_project_id_capability_id_pk" PRIMARY KEY("project_id","capability_id")
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'projects_to_capabilities_project_id_projects_id_fk'
			AND conrelid = 'public.projects_to_capabilities'::regclass
	) THEN
		ALTER TABLE "public"."projects_to_capabilities"
			ADD CONSTRAINT "projects_to_capabilities_project_id_projects_id_fk"
			FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'projects_to_capabilities_capability_id_capabilities_id_fk'
			AND conrelid = 'public.projects_to_capabilities'::regclass
	) THEN
		ALTER TABLE "public"."projects_to_capabilities"
			ADD CONSTRAINT "projects_to_capabilities_capability_id_capabilities_id_fk"
			FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "capabilities_axis_code_unique" ON "capabilities" USING btree ("axis","code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capabilities_axis_idx" ON "capabilities" USING btree ("axis");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_to_capabilities_capability_id_idx" ON "projects_to_capabilities" USING btree ("capability_id");