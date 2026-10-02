-- MCP / A2A 资产的元数据安全扫描结果
--
-- 背景：`security_level` 列早就存在，但**从来没有被写入过**——注册流程不写、
-- 审核流程不写，唯一的扫描实现 `lib/security-scan/run-scan.ts` 只作用于 skills。
-- 于是详情页把空值当默认值渲染成「安全」：一个从未扫描过的资产在页面上显示为安全。
--
-- 这里补上落库字段（与 skills 表的扫描字段同构，便于复用同一套展示与审核逻辑）。
-- 评级口径见 `apps/web/src/lib/security-scan/gateway-scan.ts`：端点接入拿不到
-- 对方进程里的实际行为，只能扫**声明的元数据**，因此评级刻意保守。
ALTER TABLE "mcp_servers"
  ADD COLUMN IF NOT EXISTS "security_grade" varchar(20),
  ADD COLUMN IF NOT EXISTS "security_flags" jsonb,
  ADD COLUMN IF NOT EXISTS "security_llm_grade" varchar(20),
  ADD COLUMN IF NOT EXISTS "security_llm_analysis" text,
  ADD COLUMN IF NOT EXISTS "scanned_at" timestamp,
  ADD COLUMN IF NOT EXISTS "scan_rules_version" varchar(20);

ALTER TABLE "a2a_agents"
  ADD COLUMN IF NOT EXISTS "security_grade" varchar(20),
  ADD COLUMN IF NOT EXISTS "security_flags" jsonb,
  ADD COLUMN IF NOT EXISTS "security_llm_grade" varchar(20),
  ADD COLUMN IF NOT EXISTS "security_llm_analysis" text,
  ADD COLUMN IF NOT EXISTS "scanned_at" timestamp,
  ADD COLUMN IF NOT EXISTS "scan_rules_version" varchar(20);

-- 审核队列按评级筛选（人工复核时优先看 unsafe/reject）
CREATE INDEX IF NOT EXISTS "mcp_servers_security_grade_idx"
  ON "mcp_servers" ("security_grade") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "a2a_agents_security_grade_idx"
  ON "a2a_agents" ("security_grade") WHERE "deleted_at" IS NULL;