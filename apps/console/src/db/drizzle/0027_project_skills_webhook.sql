-- Where a project's skill documents are delivered.
--
-- These replace the deployment-wide `SKILLS_WEBHOOK_URL` environment variable:
-- the submitter supplies `callbackUrl` / `callbackSecret` on
-- `POST /api/v1/projects`, and they are recorded here per project. One console
-- can therefore serve several submitters, each with its own endpoint.
--
-- The pair has to be a column and not something threaded through the call,
-- because delivery outlives the request that asked for it — the inline push is
-- the fast path, but `push-skills` and the operator's "retry now" button both
-- run later with no request to read an address from.
--
-- Both nullable: a project curated by the discovery task, or published
-- without a callback, has no destination and its skills stay queued rather than
-- being pushed somewhere a submitter did not nominate.
ALTER TABLE "projects" ADD COLUMN "skills_webhook_url" text;
ALTER TABLE "projects" ADD COLUMN "skills_webhook_secret" text;