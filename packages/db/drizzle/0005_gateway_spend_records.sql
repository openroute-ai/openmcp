CREATE TABLE "gateway_spend_records" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text NOT NULL,
	"api_key_id" text,
	"key_alias" text,
	"spend" numeric(16, 8) DEFAULT '0' NOT NULL,
	"overspend_amount" numeric(16, 8) DEFAULT '0' NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"asset_type" varchar(20),
	"asset_name" text,
	"author_id" text,
	"model" text,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_spend_records_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "provider_earnings" ALTER COLUMN "skill_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD COLUMN "gateway_record_id" text;--> statement-breakpoint
ALTER TABLE "gateway_spend_records" ADD CONSTRAINT "gateway_spend_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_spend_records" ADD CONSTRAINT "gateway_spend_records_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_spend_records_user_idx" ON "gateway_spend_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gateway_spend_records_author_idx" ON "gateway_spend_records" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "gateway_spend_records_occurred_at_idx" ON "gateway_spend_records" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "gateway_spend_records_key_alias_idx" ON "gateway_spend_records" USING btree ("key_alias");--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_gateway_record_id_gateway_spend_records_id_fk" FOREIGN KEY ("gateway_record_id") REFERENCES "public"."gateway_spend_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_gateway_record_unique" UNIQUE("gateway_record_id");
