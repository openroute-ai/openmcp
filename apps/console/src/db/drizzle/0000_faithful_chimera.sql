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
	"updated_at" timestamp NOT NULL
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
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
CREATE TABLE "repo_weekly_stars" (
	"repo_id" text NOT NULL,
	"year" integer NOT NULL,
	"week" integer NOT NULL,
	"stars" integer NOT NULL,
	CONSTRAINT "repo_weekly_stars_repo_id_year_week_pk" PRIMARY KEY("repo_id","year","week")
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
	"pushed_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_commit" timestamp,
	"commit_count" integer,
	"contributor_count" integer,
	"mentionable_users_count" integer,
	"pull_requests_count" integer,
	"releases_count" integer,
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
	"updated_at" timestamp NOT NULL,
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
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"aliases" jsonb,
	"exclude_from_rankings" boolean DEFAULT false NOT NULL,
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
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_name_packages_name_fk" FOREIGN KEY ("name") REFERENCES "public"."packages"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_fame_to_projects" ADD CONSTRAINT "hall_of_fame_to_projects_username_hall_of_fame_username_fk" FOREIGN KEY ("username") REFERENCES "public"."hall_of_fame"("username") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_fame_to_projects" ADD CONSTRAINT "hall_of_fame_to_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sync_jobs" ADD CONSTRAINT "project_sync_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sync_jobs" ADD CONSTRAINT "project_sync_jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_tags" ADD CONSTRAINT "projects_to_tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_tags" ADD CONSTRAINT "projects_to_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readme_sync_jobs" ADD CONSTRAINT "readme_sync_jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_weekly_stars" ADD CONSTRAINT "repo_weekly_stars_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_executions" ADD CONSTRAINT "task_executions_task_definition_id_task_definitions_id_fk" FOREIGN KEY ("task_definition_id") REFERENCES "public"."task_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status" ADD CONSTRAINT "task_status_task_definition_id_task_definitions_id_fk" FOREIGN KEY ("task_definition_id") REFERENCES "public"."task_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
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
CREATE INDEX "readme_sync_jobs_status_idx" ON "readme_sync_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "readme_sync_jobs_created_at_idx" ON "readme_sync_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "repo_weekly_stars_week_idx" ON "repo_weekly_stars" USING btree ("year","week");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_name_owner_index" ON "repos" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "repos_pushed_at_idx" ON "repos" USING btree ("pushed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rising_star_projects_year_full_name_idx" ON "rising_star_projects" USING btree ("year","full_name");--> statement-breakpoint
CREATE INDEX "rising_star_projects_year_category_idx" ON "rising_star_projects" USING btree ("year","category");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "snapshots_year_idx" ON "snapshots" USING btree ("year");--> statement-breakpoint
CREATE INDEX "task_definitions_is_enabled_idx" ON "task_definitions" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "task_executions_task_definition_id_idx" ON "task_executions" USING btree ("task_definition_id");--> statement-breakpoint
CREATE INDEX "task_executions_created_at_idx" ON "task_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "task_status_is_running_idx" ON "task_status" USING btree ("is_running");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");