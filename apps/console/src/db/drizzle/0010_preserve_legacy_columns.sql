-- Re-declare four columns that already exist in the deployed database.
--
-- These were never created by a migration: `session.active_organization_id` and
-- `session.impersonated_by` are better-auth organization-plugin columns, and
-- `repos.type` / `repos.author_id` are leftovers from an earlier schema, all
-- added to the database directly rather than through a migration file. Because
-- no migration creates them, a database built purely from `migrate` would not
-- have them — hence the `ADD COLUMN` below.
--
-- `IF NOT EXISTS` is load-bearing, not defensive decoration. The deployed
-- database already has all four, so the bare `ADD COLUMN` that `generate`
-- emitted would abort with "column already exists" and take the rest of the
-- migration with it. With it, this file is a no-op there and the columns are
-- created on a fresh database — same outcome either way.
--
-- Declared in the schema solely so `drizzle-kit push` stops offering to drop
-- them; nothing reads any of the four. See the comments on the columns.
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "type" varchar(20) DEFAULT 'application' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "author_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;
