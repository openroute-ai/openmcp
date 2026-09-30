-- An operator editing a repository's description or homepage needs the edit to
-- survive the daily GitHub sweep, which overwrites both from GitHub on every
-- pass. These flags record that a human has taken those two fields over, and
-- `toRepoUpdate` leaves them alone from then on. Same arrangement as
-- `projects.override_description` / `projects.override_url`.
--
-- Nullable rather than `notNull default false`, matching how `projects` spells
-- it: an absent flag and a false one mean the same thing, and the refresh
-- tests them with a strict `=== true`.
ALTER TABLE "repos" ADD COLUMN "override_description" boolean;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "override_homepage" boolean;
