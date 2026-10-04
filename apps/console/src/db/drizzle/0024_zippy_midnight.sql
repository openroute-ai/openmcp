CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key_id" text,
	"user_id" text,
	"callback_url" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"scopes" text[] NOT NULL,
	"project_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"platform_types" text[] DEFAULT '{}'::text[] NOT NULL,
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
	"updated_at" timestamp with time zone,
	CONSTRAINT "subscriptions_one_owner_ck" CHECK (("api_key_id" is not null) <> ("user_id" is not null))
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
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_key_idx" ON "subscriptions" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_enabled_idx" ON "subscriptions" USING btree ("enabled") WHERE "subscriptions"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_sub_idx" ON "webhook_deliveries" USING btree ("subscription_id");