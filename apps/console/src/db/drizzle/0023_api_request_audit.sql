-- §2.1 的第三条理由终于有了落点。
--
-- 自助签发打开之前，"谁改过这把 key 的权限"不是一个问题：只有 admin 能改，而 admin
-- 就是我们自己。打开之后它变成三个真问题，而 `api_keys` 一行都答不了：
--
--   1. 这个账号签了多少把 key？—— `user_id` 有了，但"发生过什么"需要历史，而
--      `api_keys` 只记录**当前**状态。
--   2. admin 改过谁的权限？—— 完全不可答：`updateScopes` 是就地覆盖，`scopes` 里
--      看不出昨天是什么。
--   3. 凭据泄漏时这把 key 调过什么？—— 只有 `last_used_at`，它回答"是否在用"。
--
-- **只记治理动作，不记每次 API 调用**（`API_AUDIT_ACTIONS`：签发/轮换/吊销/改权/
-- 改配额/放弃）。这是一个有意的取舍：调用明细会是与流量同量级的表，而上面三个问题
-- 绝大多数只需要"谁动过凭据"就能回答。真要按调用追，另开一张按月分区的表，
-- **不要扩这一张**——它没有分区，而它不需要。
--
-- 由 `drizzle-kit generate` 生成，下列语句与它产出的逐字一致；注释是后加的。

CREATE TABLE "api_request_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"key_prefix" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- `user_id` 与 `api_key_id` 刻意**不加外键**，这正是 0022 里 `user_id` 用
-- `ON DELETE CASCADE` 的对价：
--
--   - key 随账号一起消失是对的（凭据不该在注销后继续有效），但"这把 key 当时在调用"
--     必须留下。写成带外键的 text 会在删账号时静默抹掉审计线索，而那正好抹掉了这
--     张表存在的理由。
--   - `api_key_id` 同理，而且更频繁：轮换会"吊销旧的 + 插入新的"，级联删除会在
--     每次轮换时删掉一条记录——而一次轮换恰恰是最需要留痕的动作。
--
-- 因此 `key_prefix` 必须存在：key 行没了以后，它是这一行里唯一还能认出"是哪一把"
-- 的东西（`lib/api/audit.ts` 要求写入时必填）。
--
-- `action` 是 `text` 而非 enum：新动作不应该需要一次迁移（字面量联合类型在
-- `db/schema/api-request-audit.ts` 的 `API_AUDIT_ACTIONS` 里，写入处再校验）。
-- `before` / `after` 是 jsonb 而不是两张 EAV 表：读的时候永远是一次"取出整行看
-- 变更前后"，EAV 只会让每个查询变成 N+1。机密字段在**写入前**被拒绝，见
-- `API_AUDIT_FORBIDDEN_FIELDS`——这张表没有过期机制，任何机密落进去都是永久泄漏。

-- admin 治理页的默认查询："这个 owner 的 key 发生过什么"，最新在前。
CREATE INDEX "api_request_audit_user_id_created_at_idx" ON "api_request_audit" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint

-- 凭据泄漏排查的查询形状："这把 key 做过什么"。
CREATE INDEX "api_request_audit_api_key_id_idx" ON "api_request_audit" USING btree ("api_key_id");