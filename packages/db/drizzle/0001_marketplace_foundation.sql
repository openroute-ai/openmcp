CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"start" varchar(256),
	"prefix" varchar(256),
	"key" varchar(256) NOT NULL,
	"user_id" varchar(256) NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer NOT NULL,
	"rate_limit_max" integer NOT NULL,
	"request_count" integer NOT NULL,
	"remaining" integer,
	"last_request" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"team_id" text,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"subscribed" boolean DEFAULT true NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"referrer" text,
	"user_agent" text,
	"ip_address" text,
	"source" text,
	"last_email_sent_at" timestamp,
	"email_sent_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"subscribed_at" timestamp DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp,
	CONSTRAINT "newsletter_subscription_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text,
	"state" text,
	"user_id" text NOT NULL,
	"code_challenge" text,
	"code_challenge_method" varchar(10),
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"grant_types" text[] NOT NULL,
	"scope" text,
	"client_type" varchar(20) DEFAULT 'public' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_device_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"client_id" text NOT NULL,
	"scope" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_device_codes_device_code_unique" UNIQUE("device_code"),
	CONSTRAINT "oauth_device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"scope" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"price_id" text NOT NULL,
	"type" text NOT NULL,
	"interval" text,
	"user_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"subscription_id" text,
	"status" text NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"cancel_at_period_end" boolean,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recharge_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payment_url" text,
	"qr_code" text,
	"third_party_order_id" text,
	"expires_at" timestamp NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"webhook_received" boolean DEFAULT false,
	"webhook_data" jsonb,
	"remark" text,
	"type" varchar(20) DEFAULT 'recharge' NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "recharge_orders_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"tool_name" varchar(200) NOT NULL,
	"name_en" varchar(200),
	"description" text,
	"description_en" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"is_deprecated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tools_skill_tool_unique" UNIQUE("skill_id","tool_name")
);
--> statement-breakpoint
CREATE TABLE "persona_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"content" text NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_downloads" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"user_id" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"downloaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_favorite_unique" UNIQUE("persona_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "persona_likes" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_like_unique" UNIQUE("persona_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "persona_rankings" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"period" varchar(20) NOT NULL,
	"date" date NOT NULL,
	"week_start" date,
	"month_start" date,
	"rank" integer NOT NULL,
	"recent_views" integer DEFAULT 0 NOT NULL,
	"recent_downloads" integer DEFAULT 0 NOT NULL,
	"recent_likes" integer DEFAULT 0 NOT NULL,
	"recent_comments" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"updated_at" timestamp,
	"popular_views" integer DEFAULT 0 NOT NULL,
	"popular_downloads" integer DEFAULT 0 NOT NULL,
	"popular_likes" integer DEFAULT 0 NOT NULL,
	"popular_comments" integer DEFAULT 0 NOT NULL,
	"popularity_score" numeric(10, 2) DEFAULT '0' NOT NULL,
	"previous_rank" integer,
	"rank_change" integer DEFAULT 0 NOT NULL,
	"trend" varchar(20),
	"metadata" jsonb,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_ranking_unique" UNIQUE("persona_id","dimension","period","date")
);
--> statement-breakpoint
CREATE TABLE "persona_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config_overrides" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_skill_unique" UNIQUE("persona_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "persona_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"version" varchar(20) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changelog" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "persona_version_unique" UNIQUE("persona_id","version")
);
--> statement-breakpoint
CREATE TABLE "persona_views" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"user_id" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" varchar(100) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"title" varchar(500) NOT NULL,
	"title_en" varchar(500),
	"description" text,
	"description_en" text,
	"author_id" text NOT NULL,
	"category_id" text,
	"image_url" text,
	"prompt_config" jsonb,
	"memory_config" jsonb,
	"deployment_profile" jsonb,
	"price_type" varchar(20) DEFAULT 'free' NOT NULL,
	"price_amount" numeric(10, 2),
	"billing_model" varchar(30),
	"unit_price" numeric(10, 4),
	"currency" varchar(3) DEFAULT 'CNY',
	"certified" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"forked_from_id" text,
	"views" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "personas_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "personas_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "provider_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"buyer_user_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"entitlement_id" text,
	"gross_amount" numeric(10, 2) NOT NULL,
	"platform_fee" numeric(10, 2) NOT NULL,
	"net_amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"status" varchar(20) DEFAULT 'payable' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_payout_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payout_channel" varchar(20),
	"payout_account" text,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" text PRIMARY KEY NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"type" varchar(20) DEFAULT 'application' NOT NULL,
	"updated_at" timestamp,
	"archived" boolean,
	"default_branch" text,
	"description" text,
	"homepage" text,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"owner_id" integer NOT NULL,
	"stargazers_count" integer,
	"topics" jsonb,
	"author_id" text,
	"pushed_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"last_commit" timestamp,
	"commit_count" integer,
	"contributor_count" integer,
	"mentionable_users_count" integer,
	"watchers_count" integer,
	"license_spdx_id" text,
	"pull_requests_count" integer,
	"releases_count" integer,
	"languages" jsonb,
	"open_graph_image_url" text,
	"uses_custom_open_graph_image" boolean,
	"latest_release_name" text,
	"latest_release_tag_name" text,
	"latest_release_published_at" timestamp,
	"latest_release_url" text,
	"latest_release_description" text,
	"forks" integer,
	"readme_content" text,
	"readme_content_zh" text,
	"description_zh" text,
	"icon_url" text,
	"open_graph_image_oss_url" text,
	"latest_release_description_zh" text
);
--> statement-breakpoint
CREATE TABLE "skill_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"content" text NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_downloads" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"downloaded_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'downloaded' NOT NULL,
	"skill_version" varchar(100),
	"skill_title" varchar(500),
	"skill_slug" varchar(500),
	CONSTRAINT "skill_downloads_user_skill_unique" UNIQUE("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"order_id" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_entitlement_user_skill_unique" UNIQUE("user_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill_favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_favorite_unique" UNIQUE("skill_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "skill_installs" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"runtime" varchar(50) NOT NULL,
	"install_path" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"skill_version" varchar(100),
	"skill_title" varchar(500),
	"skill_slug" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_installs_user_skill_runtime_unique" UNIQUE("user_id","skill_id","runtime")
);
--> statement-breakpoint
CREATE TABLE "skill_likes" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_like_unique" UNIQUE("skill_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "skill_rankings" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"period" varchar(20) NOT NULL,
	"date" date NOT NULL,
	"week_start" date,
	"month_start" date,
	"rank" integer NOT NULL,
	"recent_views" integer DEFAULT 0 NOT NULL,
	"recent_downloads" integer DEFAULT 0 NOT NULL,
	"recent_likes" integer DEFAULT 0 NOT NULL,
	"recent_comments" integer DEFAULT 0 NOT NULL,
	"recent_verifications" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"updated_at" timestamp,
	"popular_views" integer DEFAULT 0 NOT NULL,
	"popular_downloads" integer DEFAULT 0 NOT NULL,
	"popular_likes" integer DEFAULT 0 NOT NULL,
	"popular_comments" integer DEFAULT 0 NOT NULL,
	"popular_verifications" integer DEFAULT 0 NOT NULL,
	"popularity_score" numeric(10, 2) DEFAULT '0' NOT NULL,
	"previous_rank" integer,
	"rank_change" integer DEFAULT 0 NOT NULL,
	"trend" varchar(20),
	"metadata" jsonb,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_ranking_unique" UNIQUE("skill_id","dimension","period","date")
);
--> statement-breakpoint
CREATE TABLE "skill_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text NOT NULL,
	"verification_type" varchar(20) DEFAULT 'successful' NOT NULL,
	"verification_note" text,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_verification_unique" UNIQUE("skill_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"version" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"changelog" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"created_by" text,
	"source_files" jsonb,
	"package_metadata" jsonb,
	"security_grade" varchar(20),
	"security_scanned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_version_unique" UNIQUE("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "skill_views" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"user_id" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" varchar(500) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"title" varchar(500) NOT NULL,
	"title_en" varchar(500),
	"description" text,
	"description_en" text,
	"summary" text,
	"meta_description" text,
	"author_id" text NOT NULL,
	"category_id" text,
	"image_url" text,
	"readme" text,
	"readme_en" text,
	"version" varchar(100),
	"features" jsonb,
	"scenario" text,
	"price_type" varchar(20) DEFAULT 'free' NOT NULL,
	"price_amount" numeric(10, 2),
	"billing_model" varchar(30),
	"unit_price" numeric(10, 4),
	"currency" varchar(3) DEFAULT 'CNY',
	"certified" boolean DEFAULT false NOT NULL,
	"certified_at" timestamp,
	"certified_by" text,
	"certification_note" text,
	"security_level" varchar(50),
	"security_grade" varchar(20) DEFAULT 'unknown',
	"security_flags" jsonb,
	"security_llm_grade" varchar(20),
	"security_llm_analysis" jsonb,
	"trust_tier" integer,
	"scanned_at" timestamp,
	"scan_rules_version" varchar(50),
	"review_status" varchar(30),
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_comment" text,
	"source_type" varchar(20),
	"github_url" text,
	"visibility" varchar(20) DEFAULT 'public',
	"last_audit_report_url" text,
	"verification_count" integer DEFAULT 0 NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"mcp_schema_version" varchar(50),
	"required_permissions" jsonb,
	"sandbox_pass_rate" numeric(5, 4),
	"last_sandbox_at" timestamp,
	"forked_from_id" text,
	"metadata" jsonb,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skills_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "repo_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp,
	"year" integer NOT NULL,
	"day" integer NOT NULL,
	"month" integer NOT NULL,
	"week" integer NOT NULL,
	"forks" integer,
	"stars" integer,
	"watchers" integer,
	"open_issues" integer,
	"subscribers" integer,
	"contributors" integer,
	"pull_requests" integer,
	"releases" integer,
	"commits" integer,
	CONSTRAINT "repo_snapshots_repo_day_unique" UNIQUE("repo_id","year","month","day")
);
--> statement-breakpoint
CREATE TABLE "a2a_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" varchar(200) NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"description" text,
	"description_en" text,
	"logo_url" text,
	"cover_url" text,
	"agent_card_url" text,
	"agent_card" jsonb,
	"endpoint" text,
	"agent_name" varchar(200),
	"protocol_version" varchar(10) DEFAULT '1.0',
	"auth_type" varchar(30) DEFAULT 'none' NOT NULL,
	"auth_config" jsonb,
	"connection_status" varchar(20) DEFAULT 'online',
	"last_tested_at" timestamp,
	"last_test_result" jsonb,
	"health_check_enabled" boolean DEFAULT false NOT NULL,
	"litellm_agent_id" varchar(200),
	"visibility" varchar(20) DEFAULT 'public',
	"category_id" text,
	"author_id" text NOT NULL,
	"price_type" varchar(20) DEFAULT 'free' NOT NULL,
	"price_amount" numeric(10, 2),
	"billing_model" varchar(30),
	"unit_price" numeric(10, 4),
	"currency" varchar(3) DEFAULT 'CNY',
	"certified" boolean DEFAULT false NOT NULL,
	"security_level" varchar(50),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"views" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "a2a_agents_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "a2a_agents_slug_unique" UNIQUE("slug"),
	CONSTRAINT "a2a_agents_author_agent_name_unique" UNIQUE("author_id","agent_name")
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" varchar(200) NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(200) NOT NULL,
	"description" text,
	"description_en" text,
	"logo_url" text,
	"cover_url" text,
	"transport" varchar(10) DEFAULT 'http' NOT NULL,
	"endpoint" text,
	"server_name" varchar(200),
	"auth_type" varchar(30) DEFAULT 'none',
	"auth_config" jsonb,
	"connection_status" varchar(20) DEFAULT 'online',
	"last_tested_at" timestamp,
	"last_test_result" jsonb,
	"health_check_enabled" boolean DEFAULT false NOT NULL,
	"litellm_server_id" varchar(200),
	"hosting" varchar(20) DEFAULT 'self_hosted' NOT NULL,
	"scope" varchar(20) DEFAULT 'public' NOT NULL,
	"tools" jsonb,
	"category_id" text,
	"author_id" text NOT NULL,
	"price_type" varchar(20) DEFAULT 'free' NOT NULL,
	"price_amount" numeric(10, 2),
	"billing_model" varchar(30),
	"unit_price" numeric(10, 4),
	"currency" varchar(3) DEFAULT 'CNY',
	"certified" boolean DEFAULT false NOT NULL,
	"security_level" varchar(50),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"views" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_servers_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "mcp_servers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "mcp_servers_author_server_name_unique" UNIQUE("author_id","server_name")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_daily_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"date" date NOT NULL,
	"asset_type" varchar(20) NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"tokens" bigint DEFAULT 0 NOT NULL,
	"spend" numeric(16, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_daily_usage_author_date_type_unique" UNIQUE("author_id","date","asset_type")
);
--> statement-breakpoint
CREATE TABLE "provider_kyc_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"entity_type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"verification_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"supersedes_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"author_id" text,
	"organization_id" text,
	"entity_type" varchar(20) DEFAULT 'individual' NOT NULL,
	"company_name" varchar(200),
	"contact_name" varchar(100),
	"id_number" varchar(100),
	"documentation_url" text,
	"verification_status" varchar(20) DEFAULT 'unverified' NOT NULL,
	"verification_note" text,
	"verified_at" timestamp,
	"pay_channel_type" varchar(20) DEFAULT 'none' NOT NULL,
	"pay_channel_status" varchar(20) DEFAULT 'unconnected' NOT NULL,
	"pay_channel_note" text,
	"agreed_terms" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "provider_profiles_user_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "skill_review_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"assigned_to" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"review_type" varchar(20) NOT NULL,
	"reviewer_id" text,
	"decision" varchar(20),
	"review_comment" text,
	"flagged_flags" jsonb,
	"scan_rules_version" varchar(50),
	"scan_grade" varchar(20),
	"llm_grade" varchar(20),
	"duration_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"grade" varchar(20) NOT NULL,
	"llm_grade" varchar(20),
	"flags" jsonb,
	"llm_analysis" jsonb,
	"trust_tier" integer,
	"rules_version" varchar(50),
	"file_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"username" varchar(100) NOT NULL,
	"avatar" text,
	"avatar_url" text,
	"description" text,
	"bio" text,
	"website" text,
	"twitter" text,
	"linkedin" text,
	"github" text,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp,
	"verified_by" text,
	"verification_note" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "authors_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "balances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(16, 8) DEFAULT '0' NOT NULL,
	"credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"credits_gifted" numeric(10, 2) DEFAULT '0' NOT NULL,
	"credits_spend" numeric(10, 2) DEFAULT '0' NOT NULL,
	"credits_total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'CNY' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"amount_total" numeric(16, 8) DEFAULT '0' NOT NULL,
	"amount_gifted" numeric(16, 8) DEFAULT '0' NOT NULL,
	"amount_spend" numeric(16, 8) DEFAULT '0' NOT NULL,
	"last_sync_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" varchar(100),
	"name" varchar(100) NOT NULL,
	"name_en" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"description_en" text,
	"icon" text,
	"order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_name_en_unique" UNIQUE("name_en"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workflow_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"category_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_category_unique" UNIQUE("workflow_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"content" text NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_downloads" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"downloaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_favorite_unique" UNIQUE("workflow_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_likes" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_like_unique" UNIQUE("workflow_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"node_type" varchar(200) NOT NULL,
	"node_name" varchar(200),
	"node_name_en" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_rankings" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"period" varchar(20) NOT NULL,
	"date" date NOT NULL,
	"week_start" date,
	"month_start" date,
	"rank" integer NOT NULL,
	"recent_views" integer DEFAULT 0 NOT NULL,
	"recent_downloads" integer DEFAULT 0 NOT NULL,
	"recent_likes" integer DEFAULT 0 NOT NULL,
	"recent_comments" integer DEFAULT 0 NOT NULL,
	"recent_verifications" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp,
	"updated_at" timestamp,
	"popular_views" integer DEFAULT 0 NOT NULL,
	"popular_downloads" integer DEFAULT 0 NOT NULL,
	"popular_likes" integer DEFAULT 0 NOT NULL,
	"popular_comments" integer DEFAULT 0 NOT NULL,
	"popular_verifications" integer DEFAULT 0 NOT NULL,
	"popularity_score" numeric(10, 2) DEFAULT '0' NOT NULL,
	"previous_rank" integer,
	"rank_change" integer DEFAULT 0 NOT NULL,
	"trend" varchar(20),
	"metadata" jsonb,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_ranking_unique" UNIQUE("workflow_id","dimension","period","date")
);
--> statement-breakpoint
CREATE TABLE "workflow_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text NOT NULL,
	"verification_type" varchar(20) DEFAULT 'successful' NOT NULL,
	"verification_note" text,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_verification_unique" UNIQUE("workflow_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"version" varchar(20) NOT NULL,
	"workflow_json" jsonb NOT NULL,
	"changelog" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_version_unique" UNIQUE("workflow_id","version")
);
--> statement-breakpoint
CREATE TABLE "workflow_views" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"user_id" text,
	"ip_address" varchar(45),
	"user_agent" text,
	"viewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"reference_id" varchar(100) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"title" varchar(500) NOT NULL,
	"title_en" varchar(500),
	"description" text,
	"description_en" text,
	"summary" text,
	"meta_description" text,
	"author_id" text NOT NULL,
	"image_url" text,
	"workflow_url" text,
	"workflow_json" jsonb,
	"readme" text,
	"readme_en" text,
	"price_type" varchar(20) DEFAULT 'free' NOT NULL,
	"price_amount" numeric(10, 2),
	"currency" varchar(3) DEFAULT 'CNY',
	"complexity" varchar(20),
	"certified" boolean DEFAULT false NOT NULL,
	"certified_at" timestamp,
	"certified_by" text,
	"certification_note" text,
	"verification_count" integer DEFAULT 0 NOT NULL,
	"popularity" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_reference_id_unique" UNIQUE("reference_id"),
	CONSTRAINT "workflows_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" varchar(256) DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscription" ADD CONSTRAINT "newsletter_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_device_codes" ADD CONSTRAINT "oauth_device_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharge_orders" ADD CONSTRAINT "recharge_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_comments" ADD CONSTRAINT "persona_comments_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_downloads" ADD CONSTRAINT "persona_downloads_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_favorites" ADD CONSTRAINT "persona_favorites_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_likes" ADD CONSTRAINT "persona_likes_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_rankings" ADD CONSTRAINT "persona_rankings_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_skills" ADD CONSTRAINT "persona_skills_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_skills" ADD CONSTRAINT "persona_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_views" ADD CONSTRAINT "persona_views_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_forked_from_id_personas_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_payout_requests" ADD CONSTRAINT "provider_payout_requests_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_comments" ADD CONSTRAINT "skill_comments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_downloads" ADD CONSTRAINT "skill_downloads_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_entitlements" ADD CONSTRAINT "skill_entitlements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_favorites" ADD CONSTRAINT "skill_favorites_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_installs" ADD CONSTRAINT "skill_installs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_likes" ADD CONSTRAINT "skill_likes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_rankings" ADD CONSTRAINT "skill_rankings_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_verifications" ADD CONSTRAINT "skill_verifications_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_views" ADD CONSTRAINT "skill_views_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_forked_from_id_skills_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_snapshots" ADD CONSTRAINT "repo_snapshots_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_agents" ADD CONSTRAINT "a2a_agents_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "a2a_agents" ADD CONSTRAINT "a2a_agents_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_daily_usage" ADD CONSTRAINT "provider_daily_usage_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_kyc_submissions" ADD CONSTRAINT "provider_kyc_submissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_kyc_submissions" ADD CONSTRAINT "provider_kyc_submissions_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_kyc_submissions" ADD CONSTRAINT "provider_kyc_submissions_supersedes_id_provider_kyc_submissions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."provider_kyc_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_review_assignments" ADD CONSTRAINT "skill_review_assignments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_review_assignments" ADD CONSTRAINT "skill_review_assignments_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_review_assignments" ADD CONSTRAINT "skill_review_assignments_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_reviews" ADD CONSTRAINT "skill_reviews_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_reviews" ADD CONSTRAINT "skill_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_scans" ADD CONSTRAINT "skill_scans_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_categories" ADD CONSTRAINT "workflow_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_downloads" ADD CONSTRAINT "workflow_downloads_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_favorites" ADD CONSTRAINT "workflow_favorites_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_likes" ADD CONSTRAINT "workflow_likes_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_rankings" ADD CONSTRAINT "workflow_rankings_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_verifications" ADD CONSTRAINT "workflow_verifications_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_views" ADD CONSTRAINT "workflow_views_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apiKeys_userId_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "oauthAuthorizationCodes_userId_idx" ON "oauth_authorization_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthDeviceCodes_userId_idx" ON "oauth_device_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthTokens_userId_idx" ON "oauth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_userId_idx" ON "payment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rechargeOrders_userId_idx" ON "recharge_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mcp_tools_skill_idx" ON "mcp_tools" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "mcp_tools_tool_name_idx" ON "mcp_tools" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "persona_comments_persona_idx" ON "persona_comments" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_comments_user_idx" ON "persona_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persona_comments_parent_idx" ON "persona_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "persona_comments_status_idx" ON "persona_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "persona_downloads_persona_idx" ON "persona_downloads" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_downloads_user_idx" ON "persona_downloads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persona_downloads_date_idx" ON "persona_downloads" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "persona_favorites_persona_idx" ON "persona_favorites" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_favorites_user_idx" ON "persona_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persona_likes_persona_idx" ON "persona_likes" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_likes_user_idx" ON "persona_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persona_rankings_dimension_period_date_idx" ON "persona_rankings" USING btree ("dimension","period","date");--> statement-breakpoint
CREATE INDEX "persona_rankings_persona_dimension_idx" ON "persona_rankings" USING btree ("persona_id","dimension");--> statement-breakpoint
CREATE INDEX "persona_rankings_period_date_rank_idx" ON "persona_rankings" USING btree ("period","date","rank");--> statement-breakpoint
CREATE INDEX "persona_rankings_week_idx" ON "persona_rankings" USING btree ("dimension","week_start");--> statement-breakpoint
CREATE INDEX "persona_rankings_month_idx" ON "persona_rankings" USING btree ("dimension","month_start");--> statement-breakpoint
CREATE INDEX "persona_skills_persona_idx" ON "persona_skills" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_skills_skill_idx" ON "persona_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "persona_versions_persona_idx" ON "persona_versions" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_versions_created_at_idx" ON "persona_versions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "persona_views_persona_idx" ON "persona_views" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "persona_views_user_idx" ON "persona_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "persona_views_date_idx" ON "persona_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE INDEX "personas_author_idx" ON "personas" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "personas_slug_idx" ON "personas" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "personas_status_idx" ON "personas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "personas_category_idx" ON "personas" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "personas_price_type_idx" ON "personas" USING btree ("price_type");--> statement-breakpoint
CREATE INDEX "personas_billing_model_idx" ON "personas" USING btree ("billing_model");--> statement-breakpoint
CREATE INDEX "personas_certified_idx" ON "personas" USING btree ("certified");--> statement-breakpoint
CREATE INDEX "personas_published_at_idx" ON "personas" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "personas_forked_from_idx" ON "personas" USING btree ("forked_from_id");--> statement-breakpoint
CREATE INDEX "provider_earnings_author_idx" ON "provider_earnings" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "provider_earnings_skill_idx" ON "provider_earnings" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "provider_earnings_status_idx" ON "provider_earnings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_earnings_created_at_idx" ON "provider_earnings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "provider_payout_requests_author_idx" ON "provider_payout_requests" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "provider_payout_requests_user_idx" ON "provider_payout_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_payout_requests_status_idx" ON "provider_payout_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "name_owner_index" ON "repos" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "skill_comments_skill_idx" ON "skill_comments" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_comments_user_idx" ON "skill_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_comments_parent_idx" ON "skill_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "skill_comments_status_idx" ON "skill_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_downloads_skill_idx" ON "skill_downloads" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_downloads_user_idx" ON "skill_downloads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_downloads_date_idx" ON "skill_downloads" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "skill_downloads_status_idx" ON "skill_downloads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_entitlements_user_idx" ON "skill_entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_entitlements_skill_idx" ON "skill_entitlements" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_favorites_skill_idx" ON "skill_favorites" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_favorites_user_idx" ON "skill_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_installs_user_idx" ON "skill_installs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_installs_skill_idx" ON "skill_installs" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_installs_runtime_idx" ON "skill_installs" USING btree ("runtime");--> statement-breakpoint
CREATE INDEX "skill_installs_status_idx" ON "skill_installs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_installs_installed_at_idx" ON "skill_installs" USING btree ("installed_at");--> statement-breakpoint
CREATE INDEX "skill_likes_skill_idx" ON "skill_likes" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_likes_user_idx" ON "skill_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_rankings_dimension_period_date_idx" ON "skill_rankings" USING btree ("dimension","period","date");--> statement-breakpoint
CREATE INDEX "skill_rankings_skill_dimension_idx" ON "skill_rankings" USING btree ("skill_id","dimension");--> statement-breakpoint
CREATE INDEX "skill_rankings_period_date_rank_idx" ON "skill_rankings" USING btree ("period","date","rank");--> statement-breakpoint
CREATE INDEX "skill_rankings_week_idx" ON "skill_rankings" USING btree ("dimension","week_start");--> statement-breakpoint
CREATE INDEX "skill_rankings_month_idx" ON "skill_rankings" USING btree ("dimension","month_start");--> statement-breakpoint
CREATE INDEX "skill_verifications_skill_idx" ON "skill_verifications" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_verifications_user_idx" ON "skill_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_verifications_type_idx" ON "skill_verifications" USING btree ("verification_type");--> statement-breakpoint
CREATE INDEX "skill_verifications_date_idx" ON "skill_verifications" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "skill_versions_skill_idx" ON "skill_versions" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_versions_status_idx" ON "skill_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_versions_published_at_idx" ON "skill_versions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "skill_versions_created_by_idx" ON "skill_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "skill_views_skill_idx" ON "skill_views" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_views_user_idx" ON "skill_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "skill_views_date_idx" ON "skill_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE INDEX "skills_author_idx" ON "skills" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "skills_slug_idx" ON "skills" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "skills_status_idx" ON "skills" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skills_category_idx" ON "skills" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "skills_price_type_idx" ON "skills" USING btree ("price_type");--> statement-breakpoint
CREATE INDEX "skills_billing_model_idx" ON "skills" USING btree ("billing_model");--> statement-breakpoint
CREATE INDEX "skills_certified_idx" ON "skills" USING btree ("certified");--> statement-breakpoint
CREATE INDEX "skills_security_level_idx" ON "skills" USING btree ("security_level");--> statement-breakpoint
CREATE INDEX "skills_security_grade_idx" ON "skills" USING btree ("security_grade");--> statement-breakpoint
CREATE INDEX "skills_review_status_idx" ON "skills" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "skills_popularity_idx" ON "skills" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "skills_published_at_idx" ON "skills" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "skills_forked_from_idx" ON "skills" USING btree ("forked_from_id");--> statement-breakpoint
CREATE INDEX "repo_snapshots_repo_id_idx" ON "repo_snapshots" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "repo_snapshots_year_idx" ON "repo_snapshots" USING btree ("year");--> statement-breakpoint
CREATE INDEX "a2a_agents_author_idx" ON "a2a_agents" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "a2a_agents_category_idx" ON "a2a_agents" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "a2a_agents_status_idx" ON "a2a_agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "a2a_agents_litellm_idx" ON "a2a_agents" USING btree ("litellm_agent_id");--> statement-breakpoint
CREATE INDEX "a2a_agents_price_type_idx" ON "a2a_agents" USING btree ("price_type");--> statement-breakpoint
CREATE INDEX "a2a_agents_billing_model_idx" ON "a2a_agents" USING btree ("billing_model");--> statement-breakpoint
CREATE INDEX "mcp_servers_author_idx" ON "mcp_servers" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_category_idx" ON "mcp_servers" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_status_idx" ON "mcp_servers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mcp_servers_transport_idx" ON "mcp_servers" USING btree ("transport");--> statement-breakpoint
CREATE INDEX "mcp_servers_litellm_idx" ON "mcp_servers" USING btree ("litellm_server_id");--> statement-breakpoint
CREATE INDEX "mcp_servers_price_type_idx" ON "mcp_servers" USING btree ("price_type");--> statement-breakpoint
CREATE INDEX "mcp_servers_billing_model_idx" ON "mcp_servers" USING btree ("billing_model");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "provider_daily_usage_author_idx" ON "provider_daily_usage" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "provider_daily_usage_date_idx" ON "provider_daily_usage" USING btree ("date");--> statement-breakpoint
CREATE INDEX "provider_kyc_submissions_user_idx" ON "provider_kyc_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_kyc_submissions_org_idx" ON "provider_kyc_submissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_kyc_submissions_status_idx" ON "provider_kyc_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_kyc_submissions_created_at_idx" ON "provider_kyc_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "provider_profiles_author_idx" ON "provider_profiles" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "provider_profiles_verification_idx" ON "provider_profiles" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "provider_profiles_org_idx" ON "provider_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "skill_review_assignments_skill_idx" ON "skill_review_assignments" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_review_assignments_to_idx" ON "skill_review_assignments" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "skill_review_assignments_status_idx" ON "skill_review_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skill_reviews_skill_idx" ON "skill_reviews" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_reviews_reviewer_idx" ON "skill_reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "skill_reviews_decision_idx" ON "skill_reviews" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "skill_reviews_type_idx" ON "skill_reviews" USING btree ("review_type");--> statement-breakpoint
CREATE INDEX "skill_reviews_created_at_idx" ON "skill_reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "skill_scans_skill_idx" ON "skill_scans" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_scans_created_at_idx" ON "skill_scans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "authors_username_idx" ON "authors" USING btree ("username");--> statement-breakpoint
CREATE INDEX "authors_status_idx" ON "authors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "balances_user_idx" ON "balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_active_idx" ON "categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "workflow_categories_workflow_idx" ON "workflow_categories" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_categories_category_idx" ON "workflow_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_workflow_idx" ON "workflow_comments" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_user_idx" ON "workflow_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_parent_idx" ON "workflow_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "workflow_comments_status_idx" ON "workflow_comments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflow_downloads_workflow_idx" ON "workflow_downloads" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_downloads_user_idx" ON "workflow_downloads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_downloads_date_idx" ON "workflow_downloads" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "workflow_favorites_workflow_idx" ON "workflow_favorites" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_favorites_user_idx" ON "workflow_favorites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_likes_workflow_idx" ON "workflow_likes" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_likes_user_idx" ON "workflow_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_nodes_workflow_idx" ON "workflow_nodes" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_nodes_type_idx" ON "workflow_nodes" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "workflow_rankings_dimension_period_date_idx" ON "workflow_rankings" USING btree ("dimension","period","date");--> statement-breakpoint
CREATE INDEX "workflow_rankings_workflow_dimension_idx" ON "workflow_rankings" USING btree ("workflow_id","dimension");--> statement-breakpoint
CREATE INDEX "workflow_rankings_period_date_rank_idx" ON "workflow_rankings" USING btree ("period","date","rank");--> statement-breakpoint
CREATE INDEX "workflow_rankings_week_idx" ON "workflow_rankings" USING btree ("dimension","week_start");--> statement-breakpoint
CREATE INDEX "workflow_rankings_month_idx" ON "workflow_rankings" USING btree ("dimension","month_start");--> statement-breakpoint
CREATE INDEX "workflow_verifications_workflow_idx" ON "workflow_verifications" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_verifications_user_idx" ON "workflow_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_verifications_type_idx" ON "workflow_verifications" USING btree ("verification_type");--> statement-breakpoint
CREATE INDEX "workflow_verifications_date_idx" ON "workflow_verifications" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "workflow_versions_workflow_idx" ON "workflow_versions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_views_workflow_idx" ON "workflow_views" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_views_user_idx" ON "workflow_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workflow_views_date_idx" ON "workflow_views" USING btree ("viewed_at");--> statement-breakpoint
CREATE INDEX "workflows_author_idx" ON "workflows" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "workflows_slug_idx" ON "workflows" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workflows_status_idx" ON "workflows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflows_price_type_idx" ON "workflows" USING btree ("price_type");--> statement-breakpoint
CREATE INDEX "workflows_complexity_idx" ON "workflows" USING btree ("complexity");--> statement-breakpoint
CREATE INDEX "workflows_certified_idx" ON "workflows" USING btree ("certified");--> statement-breakpoint
CREATE INDEX "workflows_verification_count_idx" ON "workflows" USING btree ("verification_count");--> statement-breakpoint
CREATE INDEX "workflows_popularity_idx" ON "workflows" USING btree ("popularity");--> statement-breakpoint
CREATE INDEX "workflows_published_at_idx" ON "workflows" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "workflows_views_idx" ON "workflows" USING btree ("views");--> statement-breakpoint
CREATE INDEX "workflows_downloads_idx" ON "workflows" USING btree ("downloads");