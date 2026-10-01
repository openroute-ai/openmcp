# 设计文档 v4（最终）—— 双端点分工 + 审计字段 + 单一定时任务

> 本轮新增：repo_stargazers 增加 created_at；其他表补充必要审计字段；Vercel 限制：仅一个每日定时任务，由它按日期/时间触发周/月任务。

## 1. 数据源分工

| 角色 | 端点 | 成本 | 产出 | 失败处理 |
|---|---|---|---|---|
| 主取数 | GET /repos/{o}/{r}/stargazers/history | O(周数)，无需认证，≤100 页 | 三张 stats 表的 total_stars/delta_stars/delta_new_stars | 重试后跳过 |
| 补充 | GET /repos/{o}/{r}/stargazers（fetchStargazersWithTimestamps） | O(星标数) | repo_stargazers 明细（login + starred_at + created_at） | 403 权限 → 静默跳过；403 限流 → 照常抛 |
| 当期权威 | repos 行采样 | 0 额外请求 | 9 个 total_* + 8 个 delta_* | 单仓跳过 |

DEFAULT_STAR_CEILING 取消（主取数 O(周数)；补充端点仅在可访问仓展开，失败即 1 次请求）。

## 2. 新增 repo_stargazers 明细表（补充端点落库）

```sql
CREATE TABLE "repo_stargazers" (
  "repo_id"    text NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "login"      text NOT NULL,
  "starred_at" timestamptz NOT NULL,        -- 真实 UTC 瞬间
  "created_at" timestamptz NOT NULL DEFAULT now(),  -- 入库时间（审计）
  PRIMARY KEY ("repo_id", "login")
);
CREATE INDEX "repo_stargazers_starred_at_idx" ON "repo_stargazers" ("repo_id", "starred_at");
CREATE INDEX "repo_stargazers_created_at_idx" ON "repo_stargazers" ("created_at");
```

- MAX(starred_at) 即增量水位 → fetchStargazersWithTimestamps 传 ?since=
- 幂等 upsert（按 PK (repo_id, login)），追加不删历史
- 该数据不参与 stats 表计算，纯备用

表数 25 → 26：console-schema.integration.test.ts:44 改 toHaveLength(26)，列表加入 "repo_stargazers"（排序：readme_sync_jobs 之后、repos 之前或按字母序）。

## 3. 三张 stats 表 + 审计字段

所有时间列统一 `timestamptz`（UTC，带时区）。

```sql
-- repo_daily_stats
"period"           timestamptz NOT NULL,  -- APP_TIMEZONE 当地日 00:00 的真实 UTC 瞬间
...
"created_at"       timestamptz NOT NULL DEFAULT now(),
"updated_at"       timestamptz,

-- repo_weekly_stats
"period"           timestamptz NOT NULL,  -- ISO 周一当地 00:00
...
"created_at"       timestamptz NOT NULL DEFAULT now(),
"updated_at"       timestamptz,

-- repo_monthly_stats
"period"           timestamptz NOT NULL,  -- 当月 1 日当地 00:00
...
"created_at"       timestamptz NOT NULL DEFAULT now(),
"updated_at"       timestamptz,
```

主键 (repo_id, period)，索引 (period)。三表全部 dense。日表全量保留。

其他表（repos 等）已有 createdAt/updatedAt，不在本轮范围内改动（按约束 2 范围：stats 表 + repo_stargazers 补充必要审计字段）。

## 4. 时间口径（约束 1）

- period = 日历周期在 APP_TIMEZONE(Asia/Shanghai) 起点的真实 UTC 瞬间（例：北京 2026-10-01 → 2026-09-30T16:00:00Z）
- 入库：zonedParts(instant, tz) 取墙钟 → 推导日/ISO周/月 → instantOfCivil() 得 period
- 查询：用户 (tz, 日历周期) → 同一换算 → WHERE period >= $start AND period < $end
- 服务层保持 {year,week}/{year,month}/YYYY-MM-DD 键不变 → 路由、YearWeek、lastCompletePeriod、周/月排名数值全等
- zoneOffsetMs/instantOfLocalTime 从 schedule.ts 抽到 lib/time.ts，schedule.ts 改导入
- created_at/updated_at 用 timestamptz；本轮只改 stats 表 + repo_stargazers

## 5. 写入方矩阵

| # | 写入方 | 触发 | 写入列 | 数据源 |
|---|---|---|---|---|
| A | 主 sweep（snapshot-stars） | 首跑/rebuild + 每日 page 1 | 历史期 total_stars/delta_stars + 全期 delta_new_stars | history 端点 |
| A2 | 补充 sweep（同任务，A 之后） | 每日（since 增量） | repo_stargazers（login, starred_at, created_at） | stargazers 端点，失败忽略 |
| B | 采样器 recordCurrentPeriods | 每日 02:00（由单一定时任务调度） | 9 total_* + 8 delta_*（当期权威） | repos 行 + packages |
| C | 调用点 update-github-data | 每日 | — | 移出 curated 分支、upsertRepo 返回值捕获、按 (owner,name) 去重 |
| D | open_issues 管道 | 随 B | repos.open_issues_count | GraphQL issues(states: OPEN) 7 处 |

列所有权：
- delta_new_stars → A 独占
- total_stars/delta_stars → A 只写 period < 当期 的历史；B 写当期
- 其余 total_*/delta_* → B 独占
- repo_stargazers → A2 独占

## 6. 单一每日定时任务（约束 3）

Vercel 限制：**只有一个每日执行的定时任务**。该任务在启动后，根据当前日期和时间，调用其他周/月任务。

设计：
- 单一 orchestrator cron（每日固定时刻，如 Asia/Shanghai 02:00）负责每日主流程（update-github-data、snapshot-stars）
- 根据 `zonedParts(now, APP_TIMEZONE)` 判断：
  - 周任务（build-rankings week）：若当日是 **周一**（或上周已完成但本周未执行的判定）→ 调用周任务
  - 月任务（build-rankings month）：若当日是 **月初（1日）** → 调用月任务
  - 其他周期任务按需条件触发
- 任务间通过现有 `processItems`/task runner 调用，不新增独立 cron；`tasks/definitions.ts` 中的 cron 表达式精简为**单一每日任务**，其余周期任务改为**条件触发（on-demand/subtask）**

## 7. 读取方

- service/snapshot.ts：删 mergeMonth/getSnapshot/listSnapshots/flattenMonths/monthAt/listAllSnapshots/accumulateStarsByMonth/selectDailyStarWindow/DAILY_STARS_WINDOW_DAYS；趋势函数改吃 {total,delta}；删 90 天截断与零填充
- service/available-periods.ts：jsonb_array_elements 裸 SQL → selectDistinct
- service/rankings.ts：buildRankingsForWeek 累加→直读 total_stars+delta_stars；buildRankingsForMonth 全表扫描→SQL lag()；补负 delta 过滤
- service/rising-stars.ts：snapshots 查询改新表
- trpc/routers/{repos,projects,rankings}.ts：扁平行，snapshots → repo_monthly_stats
- components/{console-repo-detail,project-detail,project-trends}.tsx：{stars} → {total, delta}
- db/schema.ts:27：export { repos }

数值等价：{year,week}/{year,month} 服务层键不变 → 周 4 + 月 4 ranking 测试数值不变。

## 8. 迁移 0012

CREATE + 回填 + DROP（不能 RENAME；console-schema.integration.test.ts 要求 CREATE TABLE "<name>" 不带 IF NOT EXISTS；toEqual 精确断言）。

表清单（26 张）：新增 repo_stargazers。新排序含 repo_daily_stats、repo_monthly_stats、repo_weekly_stats、repo_stargazers、repos...

回填：day::date → period（APP_TIMEZONE 日历）；(year,week) → ISO 周一 period；months[].year/month → 月初 period；total_* 取旧值、delta_* = total − lag(total)、缺期补齐（dense）。

边界声明：历史桶由旧 UTC 口径推导，新桶按 APP_TIMEZONE 日历，边界位移 ≤8h。

mcp-schema.ts 的 snapshots 表名为 "repo_snapshots"（独立包独立库）→ 与 console 无冲突，删除安全。

## 9. 测试

snapshot.test.ts（mergeMonth/accumulateStarsByMonth/selectDailyStarWindow → 新分桶）、snapshot.integration.test.ts、rankings.integration.test.ts（周4+月4+负值 case + db.delete 改名）、console-schema.integration.test.ts（表名改写 + toHaveLength(26)）、6 个 db.delete(snapshots) 集成测试、console-auth.integration.test.ts:190、fakes.ts:31。

## 10. 上线

1. 用 contributor token 打一次 stargazers/history 验证
2. 部署 + pnpm --filter console db:migrate（0012）
3. 跑一次 snapshot-stars（首跑覆盖所有仓：A 主 sweep + A2 补充 sweep）
4. 次日 02:00 起单一定时任务接管（update-github-data → snapshot-stars → 条件触发周/月排名）

## 11. 已知取舍

1. 双 star delta：历史期相等，采样期分离（净 vs 毛）
2. 掉星：历史期被追溯抹除，采样期体现在负 delta_stars
3. open_issues 真降到 0 不更新（NON_ZERO_ONLY 既有权衡）
4. total_downloads 跨月负跳变 → 读取层置 undefined
5. 历史桶边界位移 ≤8h
6. 403 权限错跳过 vs 403 限流照常抛
7. NON_ZERO_ONLY_COUNTERS 既有权衡沿用
