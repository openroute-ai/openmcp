ALTER TABLE "api_keys" ADD COLUMN "provider" varchar(32) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "key_alias" varchar(256);--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "litellm_key_name" varchar(256);
