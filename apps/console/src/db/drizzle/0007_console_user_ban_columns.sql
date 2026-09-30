-- console has its own database and its own `user` table, so it carries every
-- column Better Auth touches rather than borrowing the shared one. Four were
-- missing: `banned` / `banReason` / `banExpires` / `customerId`.
--
-- They are not decorative. Better Auth's built-in admin plugin reads and writes
-- `banned`, `banReason` and `banExpires` on every ban check and on
-- `banUser()` / `unbanUser()`, and `customerId` is the billing/stripe link. The
-- plugin is active regardless of which columns the table declares, so leaving
-- them out does not disable banning — it makes the write fail on a column that
-- does not exist. Nullable, matching the shared table: an account nobody has
-- banned is `banned IS NULL` / `banned = false`, and no existing row is
-- rewritten by this migration.
ALTER TABLE "user" ADD COLUMN "banned" boolean;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "customer_id" text;
