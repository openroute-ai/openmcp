-- `snapshots` is preserved, not rebuilt.
--
-- This file exists so that a database which lost the table can get the schema
-- back, and it is written to be a no-op everywhere else:
--
--   - Live and freshly migrated databases already have `snapshots` with exactly
--     the shape declared below, so `CREATE TABLE IF NOT EXISTS` does nothing and
--     its rows are never touched. The 748 rows in the live database stay.
--   - Only a database that ran the *original* `0012` -- the version that ended
--     in `DROP TABLE "snapshots"` -- is missing the table. That table was dropped
--     with its rows, so this migration can restore the schema but not the data;
--     recovering those rows needs a backup taken before `0012` ran.
--
-- Every statement is additive and conditional:
--
--   - `CREATE TABLE IF NOT EXISTS` never replaces an existing table.
--   - The foreign key and the primary key are added only when missing, each
--     behind a DO block. An earlier draft dropped and re-added them, which
--     rewrites a primary key across the whole table for no reason when the
--     constraint is already correct.
--   - `CREATE INDEX IF NOT EXISTS` leaves an existing index alone. Dropping and
--     recreating `snapshots_year_idx` would need a write lock on a table nothing
--     reads, purely to end up with an identical index.
--
-- This migration is approved to add objects only. It never drops, truncates or
-- rewrites anything.
--
-- `CREATE TABLE` runs first so the two DO blocks below can safely resolve
-- `'public.snapshots'::regclass`; on a database that still has the table this
-- statement is a no-op, and on one that lost it the table now exists before
-- anything references it. The primary key is declared inline rather than in a
-- DO block for that reason -- a table created here is always born with it.
CREATE TABLE IF NOT EXISTS "snapshots" (
	"repo_id" text NOT NULL,
	"year" integer NOT NULL,
	"months" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "snapshots_repo_id_year_pk" PRIMARY KEY("repo_id","year")
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'snapshots_repo_id_year_pk'
			AND conrelid = 'public.snapshots'::regclass
	) THEN
		ALTER TABLE "public"."snapshots"
			ADD CONSTRAINT "snapshots_repo_id_year_pk" PRIMARY KEY ("repo_id","year");
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'snapshots_repo_id_repos_id_fk'
			AND conrelid = 'public.snapshots'::regclass
	) THEN
		ALTER TABLE "public"."snapshots"
			ADD CONSTRAINT "snapshots_repo_id_repos_id_fk"
			FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_year_idx" ON "snapshots" USING btree ("year");
--> statement-breakpoint
-- The table holds no application data any more: its history was copied into
-- `repo_monthly_stats` by `0012`. It stays declared in
-- `src/db/schema/github.ts` so that `drizzle-kit push` treats it as managed and
-- never proposes deleting it.