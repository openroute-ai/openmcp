-- Consecutive health-check failure counter for MCP servers and A2A agents.
--
-- Why a counter instead of trusting `connection_status` directly: `connection_status`
-- gates marketplace visibility and the install path, so a scheduled probe that
-- flipped it on a single timeout would pull a healthy provider's asset out of the
-- store on one network blip — revenue stops instantly, for a condition nobody
-- observed. Counting consecutive failures means a transient error has to repeat
-- before it is allowed to act.
--
-- Reset to 0 on every successful probe, so recovery is immediate and only the
-- down-transition is damped.
ALTER TABLE "mcp_servers"
    ADD COLUMN IF NOT EXISTS "health_fail_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "a2a_agents"
    ADD COLUMN IF NOT EXISTS "health_fail_count" integer DEFAULT 0 NOT NULL;

-- The counter only means something for assets that opted in; an asset that never
-- opted in must not be pushed toward `error` by anything.
ALTER TABLE "mcp_servers"
    DROP CONSTRAINT IF EXISTS "mcp_servers_health_fail_count_check";
ALTER TABLE "mcp_servers"
    ADD CONSTRAINT "mcp_servers_health_fail_count_check"
    CHECK ("health_fail_count" >= 0);

ALTER TABLE "a2a_agents"
    DROP CONSTRAINT IF EXISTS "a2a_agents_health_fail_count_check";
ALTER TABLE "a2a_agents"
    ADD CONSTRAINT "a2a_agents_health_fail_count_check"
    CHECK ("health_fail_count" >= 0);