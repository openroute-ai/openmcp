CREATE TABLE "repo_monthly_stats" (
	"repo_id" text NOT NULL,
	"period" timestamp with time zone NOT NULL,
	"total_stars" integer,
	"delta_stars" integer,
	"delta_new_stars" integer,
	"total_watchers" integer,
	"delta_watchers" integer,
	"total_forks" integer,
	"delta_forks" integer,
	"total_open_issues" integer,
	"delta_open_issues" integer,
	"total_pull_requests" integer,
	"delta_pull_requests" integer,
	"total_releases" integer,
	"delta_releases" integer,
	"total_contributors" integer,
	"delta_contributors" integer,
	"total_commits" integer,
	"delta_commits" integer,
	"total_downloads" integer,
	"delta_downloads" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "repo_monthly_stats_repo_id_period_pk" PRIMARY KEY("repo_id","period")
);
--> statement-breakpoint
CREATE TABLE "repo_weekly_stats" (
	"repo_id" text NOT NULL,
	"period" timestamp with time zone NOT NULL,
	"total_stars" integer,
	"delta_stars" integer,
	"delta_new_stars" integer,
	"total_watchers" integer,
	"delta_watchers" integer,
	"total_forks" integer,
	"delta_forks" integer,
	"total_open_issues" integer,
	"delta_open_issues" integer,
	"total_pull_requests" integer,
	"delta_pull_requests" integer,
	"total_releases" integer,
	"delta_releases" integer,
	"total_contributors" integer,
	"delta_contributors" integer,
	"total_commits" integer,
	"delta_commits" integer,
	"total_downloads" integer,
	"delta_downloads" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "repo_weekly_stats_repo_id_period_pk" PRIMARY KEY("repo_id","period")
);
--> statement-breakpoint
CREATE TABLE "repo_daily_stats" (
	"repo_id" text NOT NULL,
	"period" timestamp with time zone NOT NULL,
	"total_stars" integer,
	"delta_stars" integer,
	"delta_new_stars" integer,
	"total_watchers" integer,
	"delta_watchers" integer,
	"total_forks" integer,
	"delta_forks" integer,
	"total_open_issues" integer,
	"delta_open_issues" integer,
	"total_pull_requests" integer,
	"delta_pull_requests" integer,
	"total_releases" integer,
	"delta_releases" integer,
	"total_contributors" integer,
	"delta_contributors" integer,
	"total_commits" integer,
	"delta_commits" integer,
	"total_downloads" integer,
	"delta_downloads" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "repo_daily_stats_repo_id_period_pk" PRIMARY KEY("repo_id","period")
);
--> statement-breakpoint
CREATE TABLE "repo_stargazers" (
	"repo_id" text NOT NULL,
	"login" text NOT NULL,
	"starred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_stargazers_repo_id_login_pk" PRIMARY KEY("repo_id","login")
);
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "open_issues_count" integer;
--> statement-breakpoint
CREATE INDEX "repo_monthly_stats_period_idx" ON "repo_monthly_stats" USING btree ("period");--> statement-breakpoint
CREATE INDEX "repo_weekly_stats_period_idx" ON "repo_weekly_stats" USING btree ("period");--> statement-breakpoint
CREATE INDEX "repo_daily_stats_period_idx" ON "repo_daily_stats" USING btree ("period");--> statement-breakpoint
CREATE INDEX "repo_stargazers_starred_at_idx" ON "repo_stargazers" USING btree ("repo_id","starred_at");--> statement-breakpoint
ALTER TABLE "repo_monthly_stats" ADD CONSTRAINT "repo_monthly_stats_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_weekly_stats" ADD CONSTRAINT "repo_weekly_stats_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_daily_stats" ADD CONSTRAINT "repo_daily_stats_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_stargazers" ADD CONSTRAINT "repo_stargazers_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "repo_monthly_stats" (
	"repo_id", "period",
	"total_stars", "delta_stars",
	"total_contributors", "delta_contributors",
	"total_downloads", "delta_downloads",
	"total_pull_requests", "delta_pull_requests",
	"total_releases", "delta_releases",
	"created_at"
)
SELECT
	"m"."repo_id",
	"m"."period",
	"m"."total_stars",
	"m"."delta_stars",
	"m"."total_contributors",
	"m"."total_contributors" - "m"."previous_contributors",
	"m"."total_downloads",
	"m"."total_downloads" - "m"."previous_downloads",
	"m"."total_pull_requests",
	"m"."total_pull_requests" - "m"."previous_pull_requests",
	"m"."total_releases",
	"m"."total_releases" - "m"."previous_releases",
	now()
FROM (
	SELECT
		"s"."repo_id",
		-- The instant Asia/Shanghai's first day of the calendar month this entry
		-- was filed under. A month stored as a year and a number has to become an
		-- instant here, because that is what the new table is keyed by; this is the
		-- one place the eight hours between the two calendars' midnights is applied
		-- to history rather than to new writes.
		(make_date(("e"->>'year')::int, ("e"->>'month')::int, 1)
			AT TIME ZONE 'Asia/Shanghai') AS "period",
		("e"->>'stars')::int AS "total_stars",
		("e"->>'stars')::int - lag(("e"->>'stars')::int) over w AS "delta_stars",
		("e"->>'totalContributors')::int AS "total_contributors",
		lag(("e"->>'totalContributors')::int) over w AS "previous_contributors",
		("e"->>'totalDownloads')::int AS "total_downloads",
		lag(("e"->>'totalDownloads')::int) over w AS "previous_downloads",
		("e"->>'totalPullRequests')::int AS "total_pull_requests",
		lag(("e"->>'totalPullRequests')::int) over w AS "previous_pull_requests",
		("e"->>'totalReleases')::int AS "total_releases",
		lag(("e"->>'totalReleases')::int) over w AS "previous_releases"
	FROM "snapshots" "s"
	CROSS JOIN LATERAL jsonb_array_elements(
		coalesce("s"."months", '[]'::jsonb)
	) AS "e"
	WHERE ("e"->>'year')::int IS NOT NULL
		AND ("e"->>'month')::int BETWEEN 1 AND 12
		AND ("e"->>'stars')::int IS NOT NULL
	WINDOW w AS (
		PARTITION BY "s"."repo_id"
		ORDER BY ("e"->>'year')::int, ("e"->>'month')::int
	)
) "m"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "repo_weekly_stats" (
	"repo_id", "period", "total_stars", "delta_stars", "delta_new_stars"
)
SELECT
	"v"."repo_id",
	"v"."period",
	"v"."total_stars",
	"v"."stars",
	"v"."stars"
FROM (
	SELECT
		"h"."repo_id",
		-- The instant the ISO week's Monday opened in Shanghai. The old table
		-- stored only a year and a week number, so the Monday has to be
		-- reconstructed before it can become a period: 4 January is always in ISO
		-- week 1, `date_trunc` lands on its Monday, and the remaining weeks are
		-- whole weeks from there.
		(
			date_trunc(
				'week',
				date '2006-01-04'
					+ make_interval(weeks => "h"."week" - 1)
					+ make_interval(years => "h"."year" - 2006)
			)::timestamp AT TIME ZONE 'Asia/Shanghai'
		) AS "period",
		-- The old weekly rows counted the stargazers gained *during* each week,
		-- so the level has to be the running sum up to and including this one.
		-- Copying the row's own count into `total_stars` would restart every
		-- repository's history at zero on its first recorded week.
		sum("h"."stars") over (
			PARTITION BY "h"."repo_id"
			ORDER BY "h"."year", "h"."week"
			ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
		) AS "total_stars",
		"h"."stars"
	FROM "repo_weekly_stars" "h"
	WHERE "h"."week" BETWEEN 1 AND 53
) "v"
ON CONFLICT DO NOTHING;
-- The legacy number counted arrivals during the week, so it is written to both
-- the gross and the net column: it is the only figure old rows carried, and
-- leaving `delta_stars` null would drop every pre-migration week out of the
-- weekly ranking.--> statement-breakpoint
INSERT INTO "repo_daily_stats" (
	"repo_id", "period", "total_stars", "delta_stars", "delta_new_stars"
)
SELECT
	"v"."repo_id",
	"v"."period",
	"v"."total_stars",
	"v"."stars",
	"v"."stars"
FROM (
	SELECT
		"d"."repo_id",
		("d"."day"::timestamp AT TIME ZONE 'Asia/Shanghai') AS "period",
		-- Same argument as the weekly rows: the old daily rows counted the day's
		-- arrivals, so the level is the running sum.
		sum("d"."stars") over (
			PARTITION BY "d"."repo_id"
			ORDER BY "d"."day"
			ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
		) AS "total_stars",
		"d"."stars"
	FROM "repo_daily_stars" "d"
) "v"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DROP TABLE "snapshots";--> statement-breakpoint
DROP TABLE "repo_weekly_stars";--> statement-breakpoint
DROP TABLE "repo_daily_stars";