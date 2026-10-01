/**
 * 阈值行为的回归测试。
 *
 * 这一层值得单独钉住，因为它**不碰数据库也跑得很快**，而它恰好是整个异动流里唯一
 * 会静默给出错误答案的地方：`rules.ts` 里没有任何一行会报错，一条阈值写反的规则
 * 会照常返回一条结论，只是那条结论是编的。集成测试能验出「行写进去了」，验不出
 * 「这条结论对不对」。
 *
 * 每个用例都同时断言**命中**与**未命中**两侧，因为误报和漏报在这里是同一种失败：
 * 一个把 `>=` 写成 `>` 的规则，在「刚好等于阈值」这个输入上会安静地给出相反的答案，
 * 而这个输入恰恰是最常出现在真实数据上的那一个。
 */

import { describe, expect, it } from "vitest"

import {
  THRESHOLDS,
  detectCommitStall,
  detectLicenseChange,
  detectReleaseStall,
  detectStarAcceleration,
  detectStarCliff,
  evaluate,
  median,
  type RadarSubject,
  type RadarWeek,
} from "@/lib/radar/rules"

const DAY = 86_400_000
const NOW = new Date("2026-03-02T00:00:00.000Z")

/** 三周前的周一，与 NOW 所在周的周一同源，测试里不需要真的对齐。 */
function weekAgo(count: number): Date {
  return new Date(NOW.getTime() - count * 7 * DAY)
}

function week(
  weeksAgo: number,
  stars: number,
  extra: Partial<Pick<RadarWeek, "commitDelta" | "releaseDelta">> = {}
): RadarWeek {
  return {
    period: weekAgo(weeksAgo),
    label: `2026-W${String(10 - weeksAgo).padStart(2, "0")}`,
    newStars: stars,
    commitDelta: extra.commitDelta ?? 12,
    releaseDelta: extra.releaseDelta ?? 0,
  }
}

function subject(overrides: Partial<RadarSubject> = {}): RadarSubject {
  return {
    repoId: "repo-1",
    now: NOW,
    weeks: [],
    lastReleaseAt: null,
    releaseIntervalDays: [],
    pushedAt: new Date(NOW.getTime() - DAY),
    license: null,
    licenseObservedAt: null,
    previousLicense: null,
    previousLicenseObservedAt: null,
    ...overrides,
  }
}

describe("median", () => {
  it("returns the middle of an odd-length sample", () => {
    expect(median([7, 3, 5])).toBe(5)
  })

  it("averages the two middles of an even-length sample", () => {
    // The smaller middle is not "the median": [1, 2, 3, 4] → 2 makes a project
    // look like it releases twice as often as it does.
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it("returns null for an empty sample so callers can branch on it", () => {
    // 0 would be indistinguishable from "releases every day", which is the
    // opposite of the truth and would collapse the stall threshold.
    expect(median([])).toBeNull()
  })
})

describe("star_cliff", () => {
  const declining = subject({
    weeks: [week(3, 100), week(2, 60), week(1, 30), week(0, 20)],
  })

  it("reports a monotone decline that falls past the ratio", () => {
    const hit = detectStarCliff(declining)
    expect(hit?.kind).toBe("star_cliff")
    expect(hit?.severity).toBe("down")
    expect(hit?.metric?.baseline).toBe(100)
    expect(hit?.metric?.latest).toBe(20)
  })

  it("carries the raw weekly series as evidence", () => {
    // §5.4 red line 2: the conclusion ships with the numbers behind it.
    const hit = detectStarCliff(declining)
    expect(hit?.evidence.series?.map((point) => point.value)).toEqual([
      "+100",
      "+60",
      "+30",
      "+20",
    ])
  })

  it("counts an unchanged week as part of a decline", () => {
    // "Non-increasing" on purpose: a flat week between two falling ones is the
    // shape real decay takes, and requiring strictly-decreasing would miss it.
    const hit = detectStarCliff(
      subject({ weeks: [week(3, 100), week(2, 60), week(1, 60), week(0, 20)] })
    )
    expect(hit?.kind).toBe("star_cliff")
  })

  it("does not report when the last week sits exactly at the ratio", () => {
    // 100 → 40 is exactly the threshold. `>=` here would report a project that
    // merely stopped growing as one that lost three quarters of its stars.
    const hit = detectStarCliff(
      subject({ weeks: [week(3, 100), week(2, 70), week(1, 55), week(0, 40)] })
    )
    expect(hit).toBeNull()
  })

  it("does not report a baseline below the absolute floor", () => {
    // 4 → 1 is a 75% drop and completely meaningless: at that size the number
    // is noise, so the ratio has nothing to divide.
    const hit = detectStarCliff(
      subject({ weeks: [week(3, 4), week(2, 3), week(1, 2), week(0, 1)] })
    )
    expect(hit).toBeNull()
  })

  it("does not report when the decline is not monotone", () => {
    const hit = detectStarCliff(
      subject({ weeks: [week(3, 100), week(2, 30), week(1, 80), week(0, 20)] })
    )
    expect(hit).toBeNull()
  })

  it("does not report on a three-week window it cannot complete", () => {
    // Three weeks of data is two intervals; the rule needs three.
    expect(
      detectStarCliff(subject({ weeks: [week(2, 100), week(1, 50), week(0, 20)] }))
    ).toBeNull()
  })
})

describe("star_acceleration", () => {
  it("reports a four-fold jump with enough absolute volume", () => {
    const hit = detectStarAcceleration(
      subject({ weeks: [week(3, 30), week(2, 80), week(1, 150), week(0, 220)] })
    )
    expect(hit?.kind).toBe("star_acceleration")
    // "我们也会说": the only rule that reports good news on the same axis.
    expect(hit?.severity).toBe("good")
  })

  it("does not report a small base growing fast", () => {
    // 2 → 40 is 20x, and it is not news.
    expect(
      detectStarAcceleration(
        subject({ weeks: [week(3, 2), week(2, 10), week(1, 25), week(0, 40)] })
      )
    ).toBeNull()
  })

  it("does not report when the latest week is below the absolute floor", () => {
    expect(
      detectStarAcceleration(
        subject({ weeks: [week(3, 5), week(2, 10), week(1, 20), week(0, 30)] })
      )
    ).toBeNull()
  })
})

describe("release_stall", () => {
  const cadence = [14, 14, 28]

  it("reports past twice the median interval", () => {
    const hit = detectReleaseStall(
      subject({
        releaseIntervalDays: cadence,
        lastReleaseAt: new Date(NOW.getTime() - 60 * DAY),
      })
    )
    // median(14, 14, 28) = 14; 14 x 2 = 28; max(28, 60) = 60; 60 days is not > 60.
    expect(hit).toBeNull()
  })

  it("reports strictly past the wider of the two thresholds", () => {
    const hit = detectReleaseStall(
      subject({
        releaseIntervalDays: [90, 90, 90],
        lastReleaseAt: new Date(NOW.getTime() - 200 * DAY),
      })
    )
    expect(hit?.kind).toBe("release_stall")
    expect(hit?.metric?.thresholdDays).toBe(180)
  })

  it("falls back to the floor when there is no interval history", () => {
    const hit = detectReleaseStall(
      subject({ lastReleaseAt: new Date(NOW.getTime() - 61 * DAY) })
    )
    expect(hit?.kind).toBe("release_stall")
    expect(hit?.metric?.medianIntervalDays).toBeNull()
    expect(hit?.metric?.thresholdDays).toBe(THRESHOLDS.releaseStall.floorDays)
  })

  it("says nothing about a repository that never released", () => {
    expect(detectReleaseStall(subject({ lastReleaseAt: null }))).toBeNull()
  })

  it("flags the median interval as an approximation", () => {
    // The number is derived from weekly buckets, so it is a multiple of 7.
    const hit = detectReleaseStall(
      subject({
        releaseIntervalDays: [7, 7, 7],
        lastReleaseAt: new Date(NOW.getTime() - 100 * DAY),
      })
    )
    expect(hit?.metric?.intervalIsApproximate).toBe(true)
  })
})

describe("commit_stall", () => {
  const quiet = [week(3, 10, { commitDelta: 0 }), week(2, 10, { commitDelta: 0 })]
  const quietWeeks = [
    ...quiet,
    week(1, 10, { commitDelta: 0 }),
    week(0, 10, { commitDelta: 0 }),
  ]

  it("reports four zero-commit weeks with an equally stale push", () => {
    const hit = detectCommitStall(
      subject({ weeks: quietWeeks, pushedAt: new Date(NOW.getTime() - 40 * DAY) })
    )
    expect(hit?.kind).toBe("commit_stall")
    expect(hit?.metric?.weeksWithoutCommits).toBe(4)
  })

  it("does not report when pushed_at moved inside the window", () => {
    // Zero commits but a fresh push: a counter nobody sampled, not a dead repo.
    const hit = detectCommitStall(
      subject({ weeks: quietWeeks, pushedAt: new Date(NOW.getTime() - 2 * DAY) })
    )
    expect(hit).toBeNull()
  })

  it("does not treat an unmeasured counter as zero", () => {
    // `null` means "nobody measured this week". Reading it as 0 would push every
    // repository whose counter was never sampled into the anomaly feed.
    const hit = detectCommitStall(
      subject({
        weeks: [
          week(3, 10, { commitDelta: null }),
          week(2, 10, { commitDelta: null }),
          week(1, 10, { commitDelta: null }),
          week(0, 10, { commitDelta: null }),
        ],
        pushedAt: new Date(NOW.getTime() - 40 * DAY),
      })
    )
    expect(hit).toBeNull()
  })

  it("does not report three quiet weeks", () => {
    expect(
      detectCommitStall(
        subject({
          weeks: [...quiet, week(0, 10, { commitDelta: 3 })],
          pushedAt: new Date(NOW.getTime() - 40 * DAY),
        })
      )
    ).toBeNull()
  })
})

describe("license_change", () => {
  it("reports a different SPDX id", () => {
    const hit = detectLicenseChange(
      subject({
        license: "AGPL-3.0",
        previousLicense: "Apache-2.0",
        previousLicenseObservedAt: new Date(NOW.getTime() - 90 * DAY),
      })
    )
    expect(hit?.kind).toBe("license_change")
    // Not `down`: this is not "it got worse", and it must not sort next to
    // decline — the next action a reader takes is completely different.
    expect(hit?.severity).toBe("risk")
    expect(hit?.metric?.from).toBe("Apache-2.0")
    expect(hit?.metric?.to).toBe("AGPL-3.0")
  })

  it("says nothing on the first observation of a repository", () => {
    // "We started recording" is not "it just changed".
    expect(detectLicenseChange(subject({ license: "MIT" }))).toBeNull()
  })

  it("says nothing when the license is unchanged", () => {
    expect(
      detectLicenseChange(subject({ license: "MIT", previousLicense: "MIT" }))
    ).toBeNull()
  })

  it("tells the reader the timestamp is an observation, not a change", () => {
    const hit = detectLicenseChange(
      subject({ license: "MIT", previousLicense: "MIT" })
    )
    expect(hit).toBeNull()

    const reported = detectLicenseChange(
      subject({
        license: "MIT",
        previousLicense: "NONE",
        previousLicenseObservedAt: new Date(NOW.getTime() - 400 * DAY),
      })
    )
    expect(reported?.evidence.notes?.join(" ")).toContain("观测时间不等于变更时间")
  })

  it("keys on when the new value was first seen, not on when we ran", () => {
    // The whole point of `licenseObservedAt`: two runs a week apart must produce
    // the same `period`, because `(repo, kind, period)` is the only dedup key
    // and a week-keyed period would re-report one transition forever.
    const observedAt = new Date(NOW.getTime() - 2 * DAY)
    const first = detectLicenseChange(
      subject({
        license: "MIT",
        licenseObservedAt: observedAt,
        previousLicense: "NONE",
      })
    )
    const aWeekLater = detectLicenseChange(
      subject({
        repoId: "repo-1",
        now: new Date(NOW.getTime() + 7 * DAY),
        weeks: [week(0, 10)],
        license: "MIT",
        licenseObservedAt: observedAt,
        previousLicense: "NONE",
      })
    )
    expect(first?.period.getTime()).toBe(observedAt.getTime())
    expect(aWeekLater?.period.getTime()).toBe(observedAt.getTime())
  })
})

describe("evaluate", () => {
  it("returns every rule that fired rather than merging them", () => {
    // A cliff and a release stall are two facts with two evidence payloads;
    // collapsing them would throw half of the evidence away.
    const hits = evaluate(
      subject({
        weeks: [
          week(3, 100, { commitDelta: 0, releaseDelta: 1 }),
          week(2, 60, { commitDelta: 0 }),
          week(1, 30, { commitDelta: 0 }),
          week(0, 20, { commitDelta: 0 }),
        ],
        lastReleaseAt: new Date(NOW.getTime() - 300 * DAY),
        releaseIntervalDays: [100, 100, 100],
        pushedAt: new Date(NOW.getTime() - 300 * DAY),
      })
    )

    expect(hits.map((hit) => hit.kind).sort()).toEqual([
      "commit_stall",
      "release_stall",
      "star_cliff",
    ])
    // Every hit carries evidence; that is red line 2 and it is not optional.
    for (const hit of hits) {
      expect(hit.evidence).toBeTruthy()
    }
  })

  it("returns nothing for a healthy repository", () => {
    expect(
      evaluate(
        subject({
          weeks: [week(1, 40), week(0, 45)],
          lastReleaseAt: new Date(NOW.getTime() - 3 * DAY),
          pushedAt: new Date(NOW.getTime() - DAY),
        })
      )
    ).toEqual([])
  })
})