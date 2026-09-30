CREATE TABLE "repo_daily_stars" (
	"repo_id" text NOT NULL,
	"day" date NOT NULL,
	"stars" integer NOT NULL,
	CONSTRAINT "repo_daily_stars_repo_id_day_pk" PRIMARY KEY("repo_id","day")
);
--> statement-breakpoint
ALTER TABLE "repo_daily_stars" ADD CONSTRAINT "repo_daily_stars_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_daily_stars_day_idx" ON "repo_daily_stars" USING btree ("day");