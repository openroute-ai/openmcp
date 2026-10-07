CREATE TABLE "asset_installs" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_type" varchar(20) NOT NULL,
	"asset_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" varchar(20) DEFAULT 'call' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"asset_name" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_installs_user_asset_unique" UNIQUE("user_id","asset_type","asset_id")
);--> statement-breakpoint
ALTER TABLE "asset_installs" ADD CONSTRAINT "asset_installs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_installs_user_idx" ON "asset_installs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "asset_installs_asset_idx" ON "asset_installs" USING btree ("asset_type","asset_id");--> statement-breakpoint
CREATE INDEX "asset_installs_status_idx" ON "asset_installs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asset_installs_installed_at_idx" ON "asset_installs" USING btree ("installed_at");
