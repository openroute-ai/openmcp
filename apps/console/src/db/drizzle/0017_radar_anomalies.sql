CREATE TABLE "repo_anomalies" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"period" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"metric" jsonb,
	"evidence" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"dismissed_by" text,
	"dismissed_at" timestamp with time zone,
	"dismiss_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_license_history" (
	"repo_id" text NOT NULL,
	"license" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_license_history_repo_id_license_pk" PRIMARY KEY("repo_id","license")
);
--> statement-breakpoint
ALTER TABLE "repo_anomalies" ADD CONSTRAINT "repo_anomalies_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_license_history" ADD CONSTRAINT "repo_license_history_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_anomalies_repo_kind_period_idx" ON "repo_anomalies" USING btree ("repo_id","kind","period");--> statement-breakpoint
CREATE INDEX "repo_anomalies_open_by_detected_idx" ON "repo_anomalies" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "repo_anomalies_repo_period_idx" ON "repo_anomalies" USING btree ("repo_id","period");--> statement-breakpoint
CREATE INDEX "repo_license_history_repo_observed_idx" ON "repo_license_history" USING btree ("repo_id","observed_at");