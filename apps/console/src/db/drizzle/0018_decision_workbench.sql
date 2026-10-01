CREATE TABLE "decision_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'collecting' NOT NULL,
	"outcome" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"position" smallint DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "decision_candidates_board_repo_unique" UNIQUE("board_id","repo_id")
);
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "decision_boards" ADD CONSTRAINT "decision_boards_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_candidates" ADD CONSTRAINT "decision_candidates_board_id_decision_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."decision_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_candidates" ADD CONSTRAINT "decision_candidates_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_boards_owner_updated_idx" ON "decision_boards" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "decision_candidates_board_position_idx" ON "decision_candidates" USING btree ("board_id","position");--> statement-breakpoint
CREATE INDEX "decision_candidates_repo_idx" ON "decision_candidates" USING btree ("repo_id");