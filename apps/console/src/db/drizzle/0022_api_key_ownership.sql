-- 自助签发的前提：key 从此有主人。
--
-- 之前 `api_keys` 是一张"接入方凭据"表——`created_by` 是签发它的 admin，
-- `submitter_id` 是它替谁提交仓库。两个字段都不回答"这把 key 属于谁"，因为在只有
-- admin 能签发的前提下这个问题没有意义：所有 key 都属于站点。
--
-- 自助打开之后它有意义了：
--   - `user_id` 是归属人。账号删除时随 key 一起消失（CASCADE，见下）。
--   - `tier` 是配额档位，'service' ⟺ `user_id IS NULL`。
--   - `last_rotated_at` 让"该换了"成为一个能显示的事实，而不是一种感觉。
--
-- 由 `drizzle-kit generate` 生成，下列语句与它产出的逐字一致；注释与最后那条 CHECK
-- 是后加的，理由写在各自身边。

ALTER TABLE "api_keys" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "tier" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_rotated_at" timestamp with time zone;--> statement-breakpoint

-- 存量数据全部是 admin 签发的接入方 key：无主 ⇒ service。DEFAULT 已经把它们填对了，
-- 所以这条 ADD COLUMN 在存量上是安全的（没有一行违反末尾的 CHECK）。默认值取
-- 'service' 而不是 'user' 的完整论证见 `db/schema/api-keys.ts` 里 `tier` 的注释 ——
-- 关键在于**这一列的 default 就是这次回填的值**，所以它决定了迁移语义，而不只是
-- 一个 INSERT 兜底。
--
-- `tier` 上没有 enum 列，也没有 CHECK('user','service')：约束真正的内容放在下面那条
-- 一致性检查里。加第三个档位应该是一次改一行字面量数组 + 一次迁移，而不是一次
-- `pg_enum` 类型重建。

-- `ON DELETE CASCADE`：账号没了，"我的 key"就不该留下一把无人能吊销的钥匙。代价是
-- 归属线索随账号一起消失，因此 `0023` 里 `api_request_audit.user_id` 刻意是不带
-- 级联的纯文本列。`created_by` / `submitter_id` 相反，是 `SET NULL`——它们记的是
-- "谁签的"和"替谁提交的"，而不是所有权。
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- `/console/api-keys` 的主查询：某个用户的 key，按创建时间倒序。
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint

-- tier 与 user_id 的一致性钉在数据库上，不只靠服务层的 `assertTierMatchesOwner`。
-- 两处都要，但理由不同：服务层抛的是一句说人话的错，直接进 tRPC 的错误体；而这一条
-- 防的是**不会经过服务层的路径**——直连 SQL、手工修数据、未来的迁移脚本。那些正是
-- 把一行数据改成自相矛盾的最便宜方式，而"无主的 user tier"是一把自助范围内、
-- 没有任何人能吊销它的 key。
--
-- 写成一行而不是两个 AND 分支，因为第二个分支很容易被写成
-- `user_id IS NOT NULL = (tier = 'user')`——那个形式看起来等价，实际放行了
-- `tier='user'` + `user_id IS NULL`。
--
-- 直接 ADD 而不是 ADD ... NOT VALID：存量已被 DEFAULT 填成全部合规，一次全表扫描
-- 换一句确定的"现存数据全部满足"是划算的。NOT VALID 只在表很大且保证为空时划算。
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tier_owner_consistency" CHECK (
	("tier" = 'service') = ("user_id" IS NULL)
);