ALTER TABLE "repos" ADD COLUMN "created_by" text;--> statement-breakpoint
CREATE INDEX "repos_created_by_idx" ON "repos" USING btree ("created_by");