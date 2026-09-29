CREATE TABLE "repo_weekly_stars" (
	"repo_id" text NOT NULL,
	"year" integer NOT NULL,
	"week" integer NOT NULL,
	"stars" integer NOT NULL,
	CONSTRAINT "repo_weekly_stars_repo_id_year_week_pk" PRIMARY KEY("repo_id","year","week")
);
--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "exclude_from_rankings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The source app excluded these codes from every ranking with a hardcoded
-- list. Existing databases must carry that behavior forward without waiting
-- for each tag to be recreated, since tag creation is where new tags default
-- to the list. This update is out of date for fresh installs (no tags exist
-- yet to flag) and Drizzle runs it once here; a later migration must not
-- assume it has already run, because it is a data change, not a schema one.
UPDATE "tags" SET "exclude_from_rankings" = true WHERE "code" IN ('meta', 'learning', 'wildcard');--> statement-breakpoint
ALTER TABLE "repo_weekly_stars" ADD CONSTRAINT "repo_weekly_stars_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_weekly_stars_week_idx" ON "repo_weekly_stars" USING btree ("year","week");