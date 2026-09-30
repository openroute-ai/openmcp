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
ALTER TABLE "tags" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects_to_capabilities" ADD CONSTRAINT "projects_to_capabilities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_to_capabilities" ADD CONSTRAINT "projects_to_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."capabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "capabilities_axis_code_unique" ON "capabilities" USING btree ("axis","code");--> statement-breakpoint
CREATE INDEX "capabilities_axis_idx" ON "capabilities" USING btree ("axis");--> statement-breakpoint
CREATE INDEX "projects_to_capabilities_capability_id_idx" ON "projects_to_capabilities" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "projects_to_tags_tag_id_idx" ON "projects_to_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tags_unreviewed_by_confidence_idx" ON "tags" USING btree ("reviewed_at","confidence");