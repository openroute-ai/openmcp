CREATE TABLE "subscription_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"cycle" text NOT NULL,
	"amount_fen" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel" text DEFAULT 'wechat' NOT NULL,
	"qr_payload" text,
	"transaction_id" text,
	"webhook_received" boolean DEFAULT false NOT NULL,
	"webhook_data" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"active_until" timestamp with time zone NOT NULL,
	"source_order_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_orders" ADD CONSTRAINT "subscription_orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_source_order_id_subscription_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."subscription_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_orders_user_created_idx" ON "subscription_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_orders_status_idx" ON "subscription_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_subscriptions_user_plan_idx" ON "user_subscriptions" USING btree ("user_id","plan");