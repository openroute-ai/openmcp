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
CREATE TABLE "connection_pairings" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"api_key_id" text,
	"user_id" text NOT NULL,
	"return_url" text NOT NULL,
	"scopes" text[] NOT NULL,
	"name" text NOT NULL,
	"created_ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection_pairings" ADD CONSTRAINT "connection_pairings_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_pairings" ADD CONSTRAINT "connection_pairings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_request_idempotency_created_at_idx" ON "api_request_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_pairings_code_idx" ON "connection_pairings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "connection_pairings_user_idx" ON "connection_pairings" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "connection_pairings_expires_at_idx" ON "connection_pairings" USING btree ("expires_at");