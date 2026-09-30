-- Track console → web skills webhook ingest provenance so marketplace rows
-- can be reconciled back to the console identity (repo#skill_dir) and re-sync
-- timestamps without overloading metadata JSON.
ALTER TABLE "skills" ADD COLUMN "external_source" varchar(50);--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "synced_from_console_at" timestamp;--> statement-breakpoint
CREATE INDEX "skills_external_source_idx" ON "skills" USING btree ("external_source");
