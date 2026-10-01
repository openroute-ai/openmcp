CREATE TABLE "user_repos" (
	"user_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"source" text DEFAULT 'console' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform_status" text DEFAULT 'tracked' NOT NULL,
	"platform_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_repos_user_id_repo_id_pk" PRIMARY KEY("user_id","repo_id")
);
--> statement-breakpoint
CREATE INDEX "user_repos_user_id_idx" ON "user_repos" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_repos_repo_id_idx" ON "user_repos" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "user_repos_user_submitted_idx" ON "user_repos" USING btree ("user_id","submitted_at");--> statement-breakpoint
ALTER TABLE "user_repos" ADD CONSTRAINT "user_repos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_repos" ADD CONSTRAINT "user_repos_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "user_repos" ("user_id", "repo_id", "source", "status", "submitted_at", "platform_status", "platform_synced_at", "created_at", "updated_at")
SELECT
	"r"."created_by",
	"r"."id",
	'console',
	'active',
	"r"."added_at",
	CASE
		WHEN "r"."archived" THEN 'archived'
		WHEN EXISTS (SELECT 1 FROM "projects" "p" WHERE "p"."repo_id" = "r"."id") THEN 'curated'
		ELSE 'tracked'
	END,
	"r"."updated_at",
	"r"."added_at",
	"r"."added_at"
FROM "repos" "r"
WHERE "r"."created_by" IS NOT NULL
	AND EXISTS (SELECT 1 FROM "user" "u" WHERE "u"."id" = "r"."created_by")
ON CONFLICT DO NOTHING;