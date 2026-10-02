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
ALTER TABLE "projects" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category_confidence" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category_evidence" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "category_reviewed_at" timestamp;--> statement-breakpoint
CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "categories_sort_order_idx" ON "categories" USING btree ("sort_order");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_category_id_idx" ON "projects" USING btree ("category_id");