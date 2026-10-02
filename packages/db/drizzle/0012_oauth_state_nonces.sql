-- Provider-side OAuth `state` nonces, for single-use enforcement.
--
-- `oauth_state` is signed with HMAC (see
-- `apps/web/src/lib/agent-install/oauth-state.ts`), which stops forgery and
-- tampering. It does not stop replay: a legitimately issued state that turns
-- up in browser history or an upstream provider's access log still passes the
-- signature check, and can be replayed to redeem another authorization code
-- against the same asset.
--
-- Consuming a state records its nonce here. The unique constraint is the whole
-- mechanism -- the application inserts with `ON CONFLICT DO NOTHING` and treats
-- a zero rowcount as a replay. Doing this in the database rather than with a
-- read-then-write in the handler means two concurrent callbacks carrying the
-- same state cannot both succeed.
--
-- Only the nonce is stored, not the full state: the state carries `authorId`
-- and the asset name, and a single-use credential has no business sitting in
-- a table in plaintext longer than it takes to consume it.
--
-- Rows are not deleted on consume. The `expires_at` index exists so a periodic
-- cleanup can drop expired rows; a cleanup that fails only grows the table, it
-- never loosens the check.

CREATE TABLE IF NOT EXISTS "oauth_state_nonces" (
    "id" text PRIMARY KEY,
    "nonce" text NOT NULL,
    "asset_name" text NOT NULL,
    "author_id" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- The replay check reads and writes this column; the uniqueness is what makes
-- "consume once" atomic.
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_state_nonces_nonce_unique" ON "oauth_state_nonces" ("nonce");

-- Cleanup scans by expiry.
CREATE INDEX IF NOT EXISTS "oauth_state_nonces_expires_at_idx" ON "oauth_state_nonces" ("expires_at");

-- Author lookups when investigating which author initiated a flow.
CREATE INDEX IF NOT EXISTS "oauth_state_nonces_author_id_idx" ON "oauth_state_nonces" ("author_id");
