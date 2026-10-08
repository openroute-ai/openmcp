/**
 * 雷达异动管线的集成测试。
 *
 * 跳过条件是 `CONSOLE_DATABASE_URL` 未设置。真正被验的是纯函数测试够不着的两件事：
 *
 * 1. **幂等**。`radar-rules.test.ts` 能验阈值，验不了"跑两次不会变成两条"。而这条
 *    是整个异动流的地基——它一旦破了，公开流会在一周之内变成同一个结论的七份拷贝。
 * 2. **物化**。结论写成一行、之后读回来的就是当时那套阈值下的答案。这正是 §5.4
 *    红线 1 的实现方式，也是唯一无法从类型上看出来的那部分。
 *
 * 用例自己造一份周历史而不是依赖 `db:seed:radar`：seed 的曲线是平的（刻意如此，
 * 因为它要展示的是"正常长什么样"），而这些用例要的是能把阈值跨过去的曲线。共用
 * 一份被其他 suite 断言过的数据，只会让这个文件的通过与否取决于别的文件跑没跑。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { and, asc, eq } from "drizzle-orm"
import { db, pool } from "@/db/client"
import { repoLicenseHistory, repoWeeklyStats, repos } from "@/db/schema"
import { upsertRepo } from "@/lib/github/service/repo"
import { upsertStatsRow } from "@/lib/github/service/stats"
import { periodOf } from "@/lib/github/snapshot-dates"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import {
  type AnomalyWithRepo,
  countOpenAnomalies,
  detectAndRecord,
  dismissAnomaly,
  falsePositiveRate,
  listOpenAnomalies,
  listRepoAnomalies,
} from "@/lib/radar/anomalies"
import { recordAndCompareLicense } from "@/lib/radar/licenses"
import { readTimeline } from "@/lib/radar/timeline"
import { readVitals } from "@/lib/radar/vitals"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

/** 2026-03-15T04:00Z 是上海时间的周日中午，落在 ISO 第 11 周里。 */
const NOW = new Date("2026-03-15T04:00:00Z")
const OWNER = "radar-test"

/** 最近一周往前数若干周的周一，与 stats 的 `period` 同一套取值。 */
function weekStart(weeksAgo: number): Date {
  return periodOf(new Date(NOW.getTime() - weeksAgo * 7 * 86_400_000), "week")
}

function repoInfo(name: string, overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    name,
    fullName: `${OWNER}/${name}`,
    owner: OWNER,
    ownerId: 4242,
    description: "",
    homepage: "",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-03-14T00:00:00Z"),
    defaultBranch: "main",
    stars: 1000,
    topics: [],
    archived: false,
    commitCount: 0,
    lastCommit: new Date(0),
    mentionableUsersCount: 0,
    watchersCount: 0,
    licenseSpdxId: "MIT",
    pullRequestsCount: 0,
    openIssuesCount: 0,
    releasesCount: 0,
    languages: [],
    forks: 0,
    openGraphImageUrl: "",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "",
    latestReleaseTagName: "",
    latestReleasePublishedAt: undefined,
    latestReleaseUrl: "",
    latestReleaseDescription: "",
    ...overrides,
  }
}

/**
 * 造一段连续的周历史。
 *
 * `weeks` 从最早到最新，每一项给出该周的新增 star 与提交数。**必须连续**：不连续的
 * 历史会被 `buildSubjects` 整体拒绝，而不是交给规则去判一个带洞的窗口。
 */
async function seedWeeks(
  repoId: string,
  weeks: { stars: number; commits: number; releases?: number }[]
): Promise<void> {
  const periods = weeks.map((_, index) => weekStart(weeks.length - 1 - index))
  for (const [index, period] of periods.entries()) {
    const week = weeks[index]!
    await upsertStatsRow(db, "week", repoId, period, {
      levels: {
        stars: 1000 + index * week.stars,
        commits: week.commits,
        releases: week.releases ?? 0,
      },
      changes: {
        newStars: week.stars,
        commits: week.commits,
        releases: week.releases ?? 0,
      },
    })
  }
}

async function seedRepo(name: string, overrides: Partial<RepoInfo> = {}) {
  const row = await upsertRepo(db, repoInfo(name, overrides))
  return row
}

describe.skipIf(!hasDatabase)("radar anomalies (integration)", () => {
  beforeAll(async () => {
    await db.delete(repos)
  })

  afterAll(async () => {
    await pool.end()
  })

  it("materialises a firing rule and is idempotent on re-run", async () => {
    const repo = await seedRepo("cliff")
    // Oldest → newest: a monotone decline well past the 40% threshold.
    await seedWeeks(repo.id, [
      { stars: 120, commits: 9 },
      { stars: 70, commits: 4 },
      { stars: 45, commits: 0 },
      { stars: 18, commits: 0 },
    ])

    const first = await detectAndRecord(db, [repo.id], NOW)
    expect(first).toBeGreaterThan(0)

    // The whole feed rests on this: running twice writes nothing.
    expect(await detectAndRecord(db, [repo.id], NOW)).toBe(0)

    const stored = await listRepoAnomalies(db, repo.id)
    const cliff = stored.find((row) => row.kind === "star_cliff")
    expect(cliff).toBeDefined()
    expect(cliff?.severity).toBe("down")
    expect(cliff?.metric?.baseline).toBe(120)
    expect(cliff?.metric?.latest).toBe(18)
    // Evidence travels in the same row as the conclusion (§5.4 red line 2).
    expect(cliff?.evidence?.series).toEqual([
      { label: expect.stringMatching(/^\d{4}-W\d{2}$/), value: "+120" },
      { label: expect.any(String), value: "+70" },
      { label: expect.any(String), value: "+45" },
      { label: expect.any(String), value: "+18" },
    ])
  })

  it("reports nothing for a healthy repository", async () => {
    const repo = await seedRepo("healthy")
    await seedWeeks(repo.id, [
      { stars: 40, commits: 12, releases: 1 },
      { stars: 42, commits: 9, releases: 1 },
      { stars: 41, commits: 11, releases: 1 },
      { stars: 44, commits: 14, releases: 1 },
    ])

    await detectAndRecord(db, [repo.id], NOW)
    expect(await listRepoAnomalies(db, repo.id)).toEqual([])
  })

  it("refuses to judge a repository whose weekly history has a hole", async () => {
    // Two contiguous weeks cannot support a three-week rule. Passing a window
    // with a gap would silently change every threshold in it.
    const repo = await seedRepo("gapped")
    await upsertStatsRow(db, "week", repo.id, weekStart(9), {
      changes: { newStars: 200, commits: 5 },
    })
    await upsertStatsRow(db, "week", repo.id, weekStart(8), {
      changes: { newStars: 20, commits: 5 },
    })
    await upsertStatsRow(db, "week", repo.id, weekStart(0), {
      changes: { newStars: 2, commits: 5 },
    })

    expect(await detectAndRecord(db, [repo.id], NOW)).toBe(0)
  })

  it("records a license change once, not once per week", async () => {
    const repo = await seedRepo("license", {
      pushedAt: new Date("2026-03-14T00:00:00Z"),
    })
    await seedWeeks(repo.id, [
      { stars: 40, commits: 5 },
      { stars: 38, commits: 5 },
    ])

    await recordAndCompareLicense(
      db,
      repo.id,
      "MIT",
      new Date(NOW.getTime() - 30 * 86_400_000)
    )
    await db
      .update(repos)
      .set({ licenseSpdxId: "AGPL-3.0" })
      .where(eq(repos.id, repo.id))

    // The first run after the flip observes the new value and reports it.
    await detectAndRecord(db, [repo.id], NOW)
    const stored = await listRepoAnomalies(db, repo.id)
    const change = stored.find((row) => row.kind === "license_change")
    expect(change?.metric?.from).toBe("MIT")
    expect(change?.metric?.to).toBe("AGPL-3.0")
    expect(change?.period.getTime()).toBe(
      (
        await db
          .select({ observedAt: repoLicenseHistory.observedAt })
          .from(repoLicenseHistory)
          .where(
            and(
              eq(repoLicenseHistory.repoId, repo.id),
              eq(repoLicenseHistory.license, "AGPL-3.0")
            )
          )
      )[0]!.observedAt.getTime()
    )

    // A week later the same transition must not be reported again: its `period`
    // is the instant the new value was first seen, and that instant does not move.
    expect(
      await detectAndRecord(
        db,
        [repo.id],
        new Date(NOW.getTime() + 7 * 86_400_000)
      )
    ).toBe(0)
    expect(
      (await listRepoAnomalies(db, repo.id)).filter(
        (r) => r.kind === "license_change"
      )
    ).toHaveLength(1)
  })

  it("keeps a dismissed anomaly out of the feed but in the record", async () => {
    const repo = await seedRepo("dismiss")
    await seedWeeks(repo.id, [
      { stars: 120, commits: 9 },
      { stars: 70, commits: 4 },
      { stars: 45, commits: 0 },
      { stars: 18, commits: 0 },
    ])
    await detectAndRecord(db, [repo.id], NOW)

    const [stored] = await listRepoAnomalies(db, repo.id, 1)
    expect(
      await dismissAnomaly(db, {
        id: stored!.id,
        dismissedBy: "operator",
        reason: "仓库被归档前的一次性活动",
        at: NOW,
      })
    ).toBe(true)

    // Out of the public feed, but still on record: §9.2's false-positive rate
    // needs it as a denominator. Scoped to this repository because earlier cases
    // in this file deliberately left open anomalies behind.
    expect(
      (await listOpenAnomalies(db)).filter((row) => row.repoId === repo.id)
    ).toEqual([])
    const remaining = await listRepoAnomalies(db, repo.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe("dismissed")

    const rate = await falsePositiveRate(db, new Date(0))
    expect(rate.total).toBeGreaterThan(0)
    expect(rate.rate).toBeGreaterThan(0)
  })

  it("freezes vitals for the timeline and the decision board alike", async () => {
    const repo = await seedRepo("vitals", {
      licenseSpdxId: "Apache-2.0",
      pushedAt: new Date("2026-03-10T00:00:00Z"),
      latestReleasePublishedAt: new Date("2026-03-01T00:00:00Z"),
    })
    await seedWeeks(repo.id, [
      { stars: 20, commits: 3 },
      { stars: 22, commits: 4 },
      { stars: 24, commits: 5 },
      { stars: 60, commits: 6 },
    ])

    const vitals = await readVitals(db, repo, NOW)
    expect(vitals.starsThisWeek).toBe(60)
    expect(vitals.license).toBe("Apache-2.0")
    expect(vitals.daysSincePush).toBe(5)
    expect(vitals.direction).toBe("up")

    await detectAndRecord(db, [repo.id], NOW)
    const timeline = await readTimeline(db, repo.id, { limit: 10 })
    expect(timeline.length).toBeGreaterThan(0)
    // Newest first, and every event carries the instant it is filed under.
    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index - 1]!.at.getTime()).toBeGreaterThanOrEqual(
        timeline[index]!.at.getTime()
      )
    }
  })

  it("does not judge an archived repository", async () => {
    const repo = await seedRepo("archived", { archived: true })
    await seedWeeks(repo.id, [
      { stars: 300, commits: 0 },
      { stars: 200, commits: 0 },
      { stars: 100, commits: 0 },
      { stars: 10, commits: 0 },
    ])

    expect(await detectAndRecord(db, [repo.id], NOW)).toBe(0)
    expect(await listRepoAnomalies(db, repo.id)).toEqual([])
  })

  it("sorts weekly rows so the newest week is the one judged", async () => {
    // The unique key is `(repo, kind, period)`; if `period` came from the clock
    // instead of the newest stored week, a daily run would write a fresh row
    // every day for one and the same verdict.
    const repo = await seedRepo("period")
    await seedWeeks(repo.id, [
      { stars: 120, commits: 9 },
      { stars: 70, commits: 4 },
      { stars: 45, commits: 0 },
      { stars: 18, commits: 0 },
    ])

    await detectAndRecord(db, [repo.id], NOW)
    await detectAndRecord(db, [repo.id], new Date(NOW.getTime() + 86_400_000))

    const cliffs = (await listRepoAnomalies(db, repo.id)).filter(
      (row) => row.kind === "star_cliff"
    )
    expect(cliffs).toHaveLength(1)

    const newest = await db
      .select({ period: repoWeeklyStats.period })
      .from(repoWeeklyStats)
      .where(eq(repoWeeklyStats.repoId, repo.id))
      .orderBy(asc(repoWeeklyStats.period))
    const latestWeek = newest[newest.length - 1]!.period
    expect(cliffs[0]?.period.getTime()).toBe(latestWeek.getTime())
  })

  it("counts and pages the open feed from one shared scope", async () => {
    // 一个能翻成好几页的流，而且每条 magnitude 不同：排序要是含糊，断言就会靠
    // 「顺序碰巧对上」蒙混过去，而翻页的全部意义就是顺序别碰巧。
    const repoIds: string[] = []
    for (let index = 0; index < 5; index += 1) {
      const repo = await seedRepo(`paged-${index}`)
      repoIds.push(repo.id)
      await seedWeeks(repo.id, [
        { stars: 120 + index * 30, commits: 9 },
        { stars: 70 + index * 10, commits: 4 },
        { stars: 45, commits: 0 },
        { stars: 18, commits: 0 },
      ])
    }
    expect(await detectAndRecord(db, repoIds, NOW)).toBeGreaterThan(0)

    const scope = { kinds: ["star_cliff" as const] }

    // 页面上那句「共 N 条」是数出来的，而 N 和翻出来的是同一个问题问的两遍。
    // 两处条件一旦漂移，最后一页会安静地不存在——页面照常渲染，只是那一页空着。
    const total = await countOpenAnomalies(db, scope)
    const all = await listOpenAnomalies(db, { ...scope, limit: 1000 })
    expect(all.length).toBeGreaterThanOrEqual(5)
    expect(total).toBe(all.length)

    // 3 条一页，对着一个不整除的总数：最后一页是短的，而偏移量算错一位的地方
    // 恰恰就是短的那一页。
    const PAGE_SIZE = 3
    const paged: AnomalyWithRepo[] = []
    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
      const slice = await listOpenAnomalies(db, {
        ...scope,
        limit: PAGE_SIZE,
        offset,
      })
      expect(slice.length).toBeLessThanOrEqual(PAGE_SIZE)
      paged.push(...slice)
    }

    // 一条不多、一条不少，且顺序和整页完全一致。两种漏法都不报错：重复看起来像
    // 流很热闹，缺一条看起来像流很冷清——所以断言的是整个序列，不只是长度。
    expect(paged.map((row) => row.id)).toEqual(all.map((row) => row.id))

    // 空页是空的，不是报错。一个被 clampPage 挡掉的过期页码最终就是这样一个偏移。
    expect(
      await listOpenAnomalies(db, { ...scope, limit: 3, offset: total + 50 })
    ).toEqual([])
  })

  it("keeps the good-news rows out of the default feed but inside the feed that asks", async () => {
    const repo = await seedRepo("accelerating")
    // 基线 20 而不是更小：加速规则要求 oldest ≥ 最低量门槛 ÷ 倍数（50 ÷ 3 ≈ 16.7），
    // 基数接近 0 时那个倍数不是加速度，是一条从零起步的横线除以横线。
    await seedWeeks(repo.id, [
      { stars: 20, commits: 5 },
      { stars: 40, commits: 5 },
      { stars: 60, commits: 5 },
      { stars: 150, commits: 5 },
    ])
    expect(await detectAndRecord(db, [repo.id], NOW)).toBeGreaterThan(0)

    const alerts = await countOpenAnomalies(db)
    const everything = await countOpenAnomalies(db, { includeGood: true })

    // `good` 与告警同表同状态（§5.4 红线 3），按严重度排除、不按 kind 排除，
    // 所以两者的差正好是那一条喜报。差值若不是 1，说明计数和列表看的不是同一份
    // 范围——而这正是翻页上界会悄悄算错的地方。
    expect(everything).toBe(alerts + 1)

    const good = await listOpenAnomalies(db, {
      kinds: ["star_acceleration" as const],
      includeGood: true,
      limit: 1000,
    })
    expect(good.find((row) => row.repoId === repo.id)?.severity).toBe("good")
    // 默认的 count 不该把它算进去，否则第一页会因为多了一条而少翻一页。
    expect(
      await countOpenAnomalies(db, { kinds: ["star_acceleration" as const] })
    ).toBe(0)
  })
})
