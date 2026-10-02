-- 网关账本补齐真实调用观测字段
--
-- 背景：Provider 后台「调用观测」原本没有可查的真实数据，指标与调用日志
-- 都是前端用 id 的 hash 生成的确定性假值。这里把 LiteLLM 上报里本来就有的
-- 真实字段落到账本上，让面板可以只读真实聚合。
ALTER TABLE "gateway_spend_records"
  ADD COLUMN IF NOT EXISTS "latency_ms" integer,
  ADD COLUMN IF NOT EXISTS "call_type" text;

-- latency_ms 来自 endTime - startTime，两个时间戳都存在且顺序正确才写入。
-- 手工写入或历史数据可能算出负数/超大值，这里兜一道。
ALTER TABLE "gateway_spend_records"
  DROP CONSTRAINT IF EXISTS "gateway_spend_records_latency_ms_check";
ALTER TABLE "gateway_spend_records"
  ADD CONSTRAINT "gateway_spend_records_latency_ms_check"
  CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0);

-- 资产维度的聚合与明细查询：每次都带 asset_type + occurred_at 范围。
CREATE INDEX IF NOT EXISTS "gateway_spend_records_asset_time_idx"
  ON "gateway_spend_records" ("asset_type", "asset_id", "occurred_at");