-- 网关资产版本管理（MCP Server / A2A Agent）
--
-- 背景：Skills 有 `skill_versions`，但端点接入的 MCP/A2A 完全没有版本概念——
-- 端点一改、工具一删、定价一调，已经购买并安装的用户手里的东西就静默变了，
-- 且没有任何记录能回答"我当初买到的到底是哪一版"。
--
-- 这里记录的是**发布行为的元数据契约快照**（端点/传输/工具/价格），不是代码备份：
-- 平台拿不到对方进程里的代码，能承诺的只有这些字段。
CREATE TABLE IF NOT EXISTS "gateway_asset_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "asset_type" varchar(20) NOT NULL,
  "asset_id" text NOT NULL,
  "version" varchar(20) NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "snapshot" jsonb,
  "changelog" text,
  "published_at" timestamp,
  "created_by" text,
  "security_grade" varchar(20),
  "security_scanned_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gateway_asset_versions_asset_version_unique" UNIQUE ("asset_type","asset_id","version")
);

CREATE INDEX IF NOT EXISTS "gateway_asset_versions_asset_idx"
  ON "gateway_asset_versions" ("asset_type","asset_id");
CREATE INDEX IF NOT EXISTS "gateway_asset_versions_status_idx"
  ON "gateway_asset_versions" ("status");

-- 当前在售版本指针 + 版本号（版本号冗余一份便于列表展示，避免每次 join）
ALTER TABLE "mcp_servers"
  ADD COLUMN IF NOT EXISTS "current_version_id" text,
  ADD COLUMN IF NOT EXISTS "current_version" varchar(20);

ALTER TABLE "a2a_agents"
  ADD COLUMN IF NOT EXISTS "current_version_id" text,
  ADD COLUMN IF NOT EXISTS "current_version" varchar(20);

-- publishedAt 倒序是版本列表的默认排序
CREATE INDEX IF NOT EXISTS "gateway_asset_versions_published_at_idx"
  ON "gateway_asset_versions" ("published_at");
