CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"tier" text DEFAULT 'service' NOT NULL,
	"created_by" text,
	"submitter_id" text,
	"scopes" text[] NOT NULL,
	"rate_limit_rpm" integer DEFAULT 60 NOT NULL,
	"rate_limit_rpd" integer DEFAULT 5000 NOT NULL,
	"last_rotated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_request_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"key_prefix" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_request_idempotency" (
	"key_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_request_idempotency_key_hash_idempotency_key_pk" PRIMARY KEY("key_hash","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "bundles" (
	"name" text PRIMARY KEY NOT NULL,
	"version" text,
	"size" integer,
	"gzip" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
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
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "decision_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'collecting' NOT NULL,
	"outcome" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "decision_candidates_board_repo_unique" UNIQUE("board_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "hall_of_fame" (
	"username" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"followers" integer,
	"bio" text,
	"homepage" text,
	"twitter" text,
	"avatar" text,
	"avatar_url" text,
	"linkedin" text,
	"github" text,
	"verified" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"npm_username" text,
	"npm_package_count" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "hall_of_fame_to_projects" (
	"username" text NOT NULL,
	"project_id" text NOT NULL,
	CONSTRAINT "hall_of_fame_to_projects_username_project_id_pk" PRIMARY KEY("username","project_id")
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"subscribed" boolean DEFAULT true NOT NULL,
	"source" text,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp,
	CONSTRAINT "newsletter_subscription_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"name" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"version" text,
	"downloads" integer,
	"dependencies" jsonb,
	"dev_dependencies" jsonb,
	"deprecated" boolean,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "project_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"skill_dir" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"description_zh" text DEFAULT '' NOT NULL,
	"readme" text NOT NULL,
	"readme_zh" text DEFAULT '' NOT NULL,
	"version" text,
	"content_hash" text,
	"synced_to_web_at" timestamp,
	"last_sync_error" text,
	"last_sync_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "project_sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"triggered_by" text NOT NULL,
	"webhook_url" text,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"override_description" boolean,
	"url" text,
	"override_url" boolean,
	"status" text NOT NULL,
	"type" text DEFAULT 'application' NOT NULL,
	"logo" text,
	"twitter" text,
	"priority" smallint DEFAULT 0 NOT NULL,
	"comments" text,
	"skill_md_path" text DEFAULT 'SKILL.md',
	"repo_id" text NOT NULL,
	"category_id" text,
	"category_confidence" double precision,
	"category_evidence" text,
	"category_reviewed_at" timestamp,
	"skills_webhook_url" text,
	"skills_webhook_secret" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects_to_capabilities" (
	"project_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"evidence" text,
	"confidence" double precision,
	"rejected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_to_capabilities_project_id_capability_id_pk" PRIMARY KEY("project_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "projects_to_tags" (
	"project_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "projects_to_tags_project_id_tag_id_pk" PRIMARY KEY("project_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "readme_sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"triggered_by" text NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
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
	"magnitude" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dismissed_by" text,
	"dismissed_at" timestamp with time zone,
	"dismiss_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "repo_license_history" (
	"repo_id" text NOT NULL,
	"license" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_license_history_repo_id_license_pk" PRIMARY KEY("repo_id","license")
);
--> statement-breakpoint
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
CREATE TABLE "repo_stargazers" (
	"repo_id" text NOT NULL,
	"login" text NOT NULL,
	"starred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_stargazers_repo_id_login_pk" PRIMARY KEY("repo_id","login")
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
CREATE TABLE "repos" (
	"id" text PRIMARY KEY NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"owner_id" integer NOT NULL,
	"stargazers_count" integer,
	"forks" integer,
	"watchers_count" integer,
	"topics" jsonb,
	"archived" boolean,
	"description" text,
	"homepage" text,
	"default_branch" text,
	"license_spdx_id" text,
	"languages" jsonb,
	"type" varchar(20) DEFAULT 'application' NOT NULL,
	"author_id" text,
	"created_by" text,
	"pushed_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_commit" timestamp,
	"commit_count" integer,
	"contributor_count" integer,
	"mentionable_users_count" integer,
	"pull_requests_count" integer,
	"releases_count" integer,
	"open_issues_count" integer,
	"open_graph_image_url" text,
	"uses_custom_open_graph_image" boolean,
	"latest_release_name" text,
	"latest_release_tag_name" text,
	"latest_release_published_at" timestamp,
	"latest_release_url" text,
	"latest_release_description" text,
	"latest_release_description_zh" text,
	"readme_content" text,
	"readme_content_zh" text,
	"description_zh" text,
	"icon_url" text,
	"open_graph_image_oss_url" text,
	"override_description" boolean,
	"override_homepage" boolean
);
--> statement-breakpoint
CREATE TABLE "rising_star_categories" (
	"year" integer PRIMARY KEY NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "rising_star_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"full_name" text NOT NULL,
	"slug" text,
	"position" smallint,
	"category" text,
	"star_delta" double precision,
	"star_count" integer,
	"contributors_count" integer,
	"score" double precision,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"repo_id" text NOT NULL,
	"year" integer NOT NULL,
	"months" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "snapshots_repo_id_year_pk" PRIMARY KEY("repo_id","year")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key_id" text NOT NULL,
	"user_id" text,
	"callback_url" text NOT NULL,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"scopes" text[] NOT NULL,
	"project_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"include_platform" boolean DEFAULT true NOT NULL,
	"include_uncurated" boolean DEFAULT true NOT NULL,
	"include_own_submissions" boolean DEFAULT true NOT NULL,
	"repo_ids" text[],
	"mode" text DEFAULT 'batch' NOT NULL,
	"filters_version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"watermark" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"last_delivered_at" timestamp with time zone,
	"last_error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"aliases" jsonb,
	"exclude_from_rankings" boolean DEFAULT false NOT NULL,
	"confidence" double precision,
	"evidence" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "tags_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "task_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cron_expression" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_daily" boolean DEFAULT false NOT NULL,
	"is_weekly" boolean DEFAULT false NOT NULL,
	"is_monthly" boolean DEFAULT false NOT NULL,
	"task_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "task_definitions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "task_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_definition_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration" integer,
	"result" jsonb,
	"error" text,
	"logs" text,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_status" (
	"task_definition_id" text PRIMARY KEY NOT NULL,
	"is_running" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"last_execution_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"role" varchar(256) DEFAULT 'user',
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	"customer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "user_repos" (
	"user_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"source" text DEFAULT 'console' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_viewed_at" timestamp,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"platform_status" text DEFAULT 'tracked' NOT NULL,
	"platform_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_repos_user_id_repo_id_pk" PRIMARY KEY("user_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"watermark" timestamp with time zone NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_submitter_id_user_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_name_packages_name_fk" FOREIGN KEY ("name") REFERENCES "public"."packages"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_boards" ADD CONSTRAINT "decision_boards_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_candidates" ADD CONSTRAINT "decision_candidates_board_id_decision_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."decision_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_candidates" ADD CONSTRAINT "decision_candidates_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_fame_to_projects" ADD CONSTRAINT "hall_of_fame_to_projects_username_hall_of_fame_username_fk" FOREIGN KEY ("username") REFERENCES "public"."hall_of_fame"("username") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_fame_to_projects" ADD CONSTRAINT "hall_of_fame_to_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscription" ADD CONSTRAINT "newsletter_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sync_jobs" ADD CONSTRAINT "project_sync_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sync_jobs" ADD CONSTRAINT "project_sync_jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_capabilities" ADD CONSTRAINT "projects_to_capabilities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_capabilities" ADD CONSTRAINT "projects_to_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_tags" ADD CONSTRAINT "projects_to_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_tags" ADD CONSTRAINT "projects_to_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readme_sync_jobs" ADD CONSTRAINT "readme_sync_jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_anomalies" ADD CONSTRAINT "repo_anomalies_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_daily_stats" ADD CONSTRAINT "repo_daily_stats_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_license_history" ADD CONSTRAINT "repo_license_history_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_monthly_stats" ADD CONSTRAINT "repo_monthly_stats_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_stargazers" ADD CONSTRAINT "repo_stargazers_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_weekly_stats" ADD CONSTRAINT "repo_weekly_stats_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_definition_id_task_definitions_id_fk" FOREIGN KEY ("task_definition_id") REFERENCES "public"."task_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status" ADD CONSTRAINT "task_status_task_definition_id_task_definitions_id_fk" FOREIGN KEY ("task_definition_id") REFERENCES "public"."task_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_repos" ADD CONSTRAINT "user_repos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_repos" ADD CONSTRAINT "user_repos_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "api_request_audit_user_id_created_at_idx" ON "api_request_audit" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_request_audit_api_key_id_idx" ON "api_request_audit" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "api_request_idempotency_created_at_idx" ON "api_request_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_axis_code_unique" ON "capabilities" USING btree ("axis","code");--> statement-breakpoint
CREATE INDEX "capabilities_axis_idx" ON "capabilities" USING btree ("axis");--> statement-breakpoint
CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "categories_sort_order_idx" ON "categories" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "decision_boards_owner_updated_idx" ON "decision_boards" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "decision_candidates_board_position_idx" ON "decision_candidates" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "decision_candidates_repo_idx" ON "decision_candidates" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "packages_project_id_idx" ON "packages" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_skills_project_id_skill_dir_idx" ON "project_skills" USING btree ("project_id","skill_dir");--> statement-breakpoint
CREATE INDEX "project_skills_synced_to_web_at_idx" ON "project_skills" USING btree ("synced_to_web_at");--> statement-breakpoint
CREATE INDEX "project_sync_jobs_status_idx" ON "project_sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "project_sync_jobs_project_id_idx" ON "project_sync_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_sync_jobs_created_at_idx" ON "project_sync_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_name_unique" ON "projects" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "projects_repo_id_idx" ON "projects" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_type_idx" ON "projects" USING btree ("type");--> statement-breakpoint
CREATE INDEX "projects_category_id_idx" ON "projects" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "projects_to_capabilities_capability_id_idx" ON "projects_to_capabilities" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "projects_to_tags_tag_id_idx" ON "projects_to_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "readme_sync_jobs_status_idx" ON "readme_sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "readme_sync_jobs_created_at_idx" ON "readme_sync_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_anomalies_repo_kind_period_idx" ON "repo_anomalies" USING btree ("repo_id","kind","period");--> statement-breakpoint
CREATE INDEX "repo_anomalies_open_by_detected_idx" ON "repo_anomalies" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "repo_anomalies_open_by_kind_magnitude_idx" ON "repo_anomalies" USING btree ("status","kind","magnitude");--> statement-breakpoint
CREATE INDEX "repo_anomalies_repo_period_idx" ON "repo_anomalies" USING btree ("repo_id","period");--> statement-breakpoint
CREATE INDEX "repo_daily_stats_period_idx" ON "repo_daily_stats" USING btree ("period");--> statement-breakpoint
CREATE INDEX "repo_license_history_repo_observed_idx" ON "repo_license_history" USING btree ("repo_id","observed_at");--> statement-breakpoint
CREATE INDEX "repo_monthly_stats_period_idx" ON "repo_monthly_stats" USING btree ("period");--> statement-breakpoint
CREATE INDEX "repo_stargazers_starred_at_idx" ON "repo_stargazers" USING btree ("repo_id","starred_at");--> statement-breakpoint
CREATE INDEX "repo_weekly_stats_period_idx" ON "repo_weekly_stats" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_name_owner_index" ON "repos" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "repos_pushed_at_idx" ON "repos" USING btree ("pushed_at");--> statement-breakpoint
CREATE INDEX "repos_created_by_idx" ON "repos" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "rising_star_projects_year_full_name_idx" ON "rising_star_projects" USING btree ("year","full_name");--> statement-breakpoint
CREATE INDEX "rising_star_projects_year_category_idx" ON "rising_star_projects" USING btree ("year","category");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "snapshots_year_idx" ON "snapshots" USING btree ("year");--> statement-breakpoint
CREATE INDEX "subscriptions_key_idx" ON "subscriptions" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_enabled_idx" ON "subscriptions" USING btree ("enabled") WHERE "subscriptions"."enabled";--> statement-breakpoint
CREATE INDEX "tags_unreviewed_by_confidence_idx" ON "tags" USING btree ("reviewed_at","confidence");--> statement-breakpoint
CREATE INDEX "task_definitions_is_enabled_idx" ON "task_definitions" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "task_executions_task_definition_id_idx" ON "task_executions" USING btree ("task_definition_id");--> statement-breakpoint
CREATE INDEX "task_executions_created_at_idx" ON "task_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "task_status_is_running_idx" ON "task_status" USING btree ("is_running");--> statement-breakpoint
CREATE INDEX "user_repos_user_id_idx" ON "user_repos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_repos_repo_id_idx" ON "user_repos" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "user_repos_user_submitted_idx" ON "user_repos" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_sub_idx" ON "webhook_deliveries" USING btree ("subscription_id");