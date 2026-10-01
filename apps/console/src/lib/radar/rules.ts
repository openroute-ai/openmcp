/**
 * 异动判定规则。
 *
 * `docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md` §5.4 的两条红线在这里落地：
 *
 * 1. **不生成 0–100 综合分。** 这个文件里没有任何一个函数返回一个「分数」。每条规则
 *    返回的是它**看的那几个原始量**和**为什么这条线被跨过**——`metric` 存前者，
 *    `evidence` 存后者。同样的数据在阈值不变时会得到同样的结论，改了阈值也会
 *    因为写进 `metric` 而看得出改的是什么。
 * 2. **每条异动必须附原始时间轴/名单/commit。** 所以 {@link RuleHit} 的 `evidence`
 *    是必填的，不是可选的。一个写不出证据的规则不该存在，而不是把证据留空。
 *
 * 全部是纯函数：不碰数据库、不读时钟（`now` 一律由参数传入），输入是已经算好的
 * 每周计数。这样阈值可以直接用单元测试钉住，也让「回填」这件事变成「拿当时的
 * `now` 重跑一遍」而不是「拿今天的数据假装是当时的数据」。
 */

import type {
  ANOMALY_KINDS,
  ANOMALY_SEVERITIES,
  EvidencePayload,
  MetricPayload,
} from "@/db/schema/github"

/** 一周的计数，作为规则引擎唯一的输入单位。 */
export interface RadarWeek {
  /** 这一周的周一 0 点（APP_TIMEZONE），与 stats 表的 `period` 同一套取值。 */
  period: Date
  /** 「2026-W03」这样的标签，只用于写给人看的证据文本。 */
  label: string
  /** 本周新增 star 数（`delta_new_stars`，到达而非净变化）。 */
  newStars: number
  /** 本周提交数增量；null 表示这一周没有测过，不等于 0。 */
  commitDelta: number | null
  /** 本周发布数增量。 */
  releaseDelta: number | null
}

/** 一个仓库在一次判定里能被规则看到的东西。 */
export interface RadarSubject {
  repoId: string
  /** 判定的时刻。不由规则自己取 `new Date()`，否则回填无法复现。 */
  now: Date

  /** 最近若干周，从最早到最新，**必须连续**（见 {@link readWeeks}）。 */
  weeks: RadarWeek[]

  /** 最近一次发布的时刻；从未发布过则 null。 */
  lastReleaseAt: Date | null

  /**
   * 历史上相邻两次发布之间的天数。
   *
   * 由 stats 表的 `delta_releases` 累加推出来——每行只知道「这周发了几次」，
   * 不知道是哪一天，所以间隔只能是 7 的整数倍，是发布**周**之间的近似而不是真实
   * 间隔天数。这个近似足够当中位数用（{@link median} 自己会排序，所以这里不要求
   * 有序），所以 `metric` 里带一个 `intervalIsApproximate` 让下游知道；但证据文案
   * 不报这个数的精度，因为那个精度是我们没有的。
   */
  releaseIntervalDays: number[]

  /** `repos.pushed_at`，最新一次推送。 */
  pushedAt: Date

  /** `repos.license_spdx_id` 的当前值。 */
  license: string | null

  /**
   * 当前这个许可证值**首次被观测到**的时刻。
   *
   * `detectLicenseChange` 的 `period` 取它而不是取 `now`，理由写在
   * `licenses.ts` 的 {@link AnomalyPeriodPolicy}：它是这条异动唯一的去重键，
   * 必须对同一次变更是恒定的，否则同一件事每周报一次。
   */
  licenseObservedAt: Date | null

  /** 历史上观测到的、与当前值不同的那个许可证；null 表示没有可比的前一个值。 */
  previousLicense: string | null

  /**
   * 上一个许可证是什么时候**被观测到**的。
   *
   * 不是变更时间——`repo_license_history.observed_at` 的列注释说明了为什么它不是。
   * 它进 `metric` 而不是被省略，是因为「这条观测有多旧」是判断它值不值得追的直接
   * 输入：一条三年前观测到的旧值刚刚被推翻了，比一条昨天观测到的更值得立刻看。
   */
  previousLicenseObservedAt: Date | null
}

/** 一条判定结果，`repo_anomalies` 的一行。 */
export interface RuleHit {
  kind: (typeof ANOMALY_KINDS)[number]
  severity: (typeof ANOMALY_SEVERITIES)[number]
  /** 判定所依据的周期起点。周规则给最近一周，月规则给当月 1 日。 */
  period: Date
  /** 一句话结论。数字由 `metric` 与 `evidence` 承载，这里只说「发生了什么」。 */
  title: string
  /**
   * 这次变化的绝对规模，同一种 `kind` 内可排序。理由与跨类不可比的说明见
   * `repo_anomalies.magnitude`。
   */
  magnitude: number
  /** 触发判定的原始量。 */
  metric: MetricPayload
  /** 原始时间轴与补充说明。必填，见本文件头的红线 2。 */
  evidence: EvidencePayload
}

/**
 * 阈值。
 *
 * 集中在一处而不是散在五个函数里，因为改阈值是这个系统唯一会反复做的事（§9.2 的
 * 误报率就是靠调它们往下压的），而「上一版是多少钱」这个问题只有在它们同处一个
 * 对象时答得出来。写进 `metric` 的是**判定时生效的**这些值，不是这些默认值——
 * 一次用临时阈值跑的回填不会在两个月后被误读成当时用的是默认值。
 */
export const THRESHOLDS = {
  /** 断崖：看最近几周。 */
  cliff: {
    /** 连续下降要覆盖几周。三周是「不是一周的抖动」的最小长度。 */
    weeks: 3,
    /** 最新一周相对最早一周只剩这个比例就报。 */
    dropRatio: 0.4,
    /** 最早一周至少要有这么多新增，否则比例没有意义。 */
    minimumBaseline: 5,
  },
  /** 加速度：最新一周相对三周前的倍数。 */
  acceleration: {
    weeks: 3,
    /** 超过这个倍数就报。 */
    factor: 3,
    /** 绝对量门槛：倍数再高，基数是 2 也不值得占一条异动。 */
    minimumLatest: 50,
  },
  /** 发布停滞。 */
  releaseStall: {
    /** 相对中位间隔的倍数。 */
    intervalFactor: 2,
    /** 中位间隔的绝对下限（天）。中位间隔很短的项目不该被 14 天不出货判停。 */
    floorDays: 60,
    /** 证据里列出最近几周的发布数，用来让人看到「不是突然停的」。 */
    evidenceWeeks: 6,
  },
  /** 提交停滞。 */
  commitStall: {
    weeks: 4,
    /**
     * `pushed_at` 的下限（天）。
     *
     * 提交数连续四周为 0 与「`pushed_at` 也没动」必须同时成立才报。四周的
     * `delta_commits` 全 0 也有别的解释——这个仓库用 release 分支、这个计数器
     * 一直没被采样到——而 `pushed_at` 停在四周之前是独立的一条证据，两条对上了
     * 才值得让人看一眼。
     */
    pushedFloorDays: 28,
  },
} as const

const MS_PER_DAY = 86_400_000

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY)
}

/**
 * 判定所依据的周期起点。
 *
 * 用**最新一周的 `period`** 而不是 `now`：`now` 是判定发生的时刻，而
 * `repo_anomalies` 的唯一键是 `(repo_id, kind, period)`。同一个仓库在周三和周六
 * 各跑一次判定，用 `now` 会写出两行内容相同、只有 `detected_at` 不同的「两次异动」，
 * 而公开流里它们会并排出现——同一条事实被数了两次。
 *
 * 没有周数据时退回 `now` 所在的周：这类仓库只有月/日粒度的规则有话说，它们的
 * `period` 也必须落在某个 stats 周期上，而不是一个任意时刻。
 */
function judgedPeriod(subject: RadarSubject): Date {
  return subject.weeks[subject.weeks.length - 1]?.period ?? subject.now
}

/** 中位数。偶数个样本取中间两个的平均，而不是偏小的那一个。 */
export function median(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * 最近 `count` 周里没有任何一次 commit 时返回 true。
 *
 * 要求**每一周都有 `commitDelta`**，而不是把 null 当 0：一个从未被采样的计数器读出
 * 「四周没有提交」，会把这个仓库推进异动流，而它其实只是没被测过。null 在这里
 * 的含义是「不知道」，而「不知道」不能推出「没有」。
 */
function hasNoCommitsFor(weeks: RadarWeek[], count: number): boolean {
  if (weeks.length < count) return false
  const window = weeks.slice(-count)
  return window.every((week) => week.commitDelta === 0)
}

/** 「+184」这样的带符号数字，用于证据文本。 */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/**
 * 把周计数渲染成证据序列。
 *
 * `label` 取自周本身（`2026-W03`），不取自「第 1 周 / 第 2 周」——后者在回看时
 * 无法定位到具体是哪一周，而证据的全部意义就是能被读者自己核对。
 */
function seriesOf(
  weeks: RadarWeek[],
  field: "newStars"
): EvidencePayload["series"] {
  return weeks.map((week) => ({
    label: week.label,
    value:
      field === "newStars"
        ? signed(week.newStars)
        : String(week.releaseDelta ?? 0),
  }))
}

/**
 * 取最近 `count` 周；不足则返回空数组（不判定）。
 *
 * 不足时返回空数组而不是部分窗口，是为了让「三周下降」永远读作三周。一条两周的
 * 下降按两周五周的比例去比，看起来和一个完整的三周下降一模一样，但它的样本少一个
 * 数量级，而那正是噪声最容易冒充信号的地方。
 */
function trailing(weeks: RadarWeek[], count: number): RadarWeek[] | null {
  return weeks.length >= count ? weeks.slice(-count) : null
}

/**
 * 新增 star 连续下降，最新一周不到三周前的四成。
 *
 * 「连续」的判据是**不增**：相等也算下降。理由是一个基数不大、周与周之间抖动几个
 * star 的项目，下降趋势里必然夹着相等的一周，把它排除掉会让规则只抓到最干净的
 * 那一类，而漏掉更常见的「先平后跌」——后者恰恰是真实衰退的样子。
 */
export function detectStarCliff(subject: RadarSubject): RuleHit | null {
  const window = trailing(subject.weeks, THRESHOLDS.cliff.weeks + 1)
  if (!window) return null

  const [oldest, ...rest] = window
  const latest = rest[rest.length - 1]!
  if (window.length < THRESHOLDS.cliff.weeks + 1) return null

  const baseline = oldest!.newStars
  if (baseline < THRESHOLDS.cliff.minimumBaseline) return null

  const nonIncreasing = rest.every(
    (week, index) => week.newStars <= window[index]!.newStars
  )
  if (!nonIncreasing) return null

  if (latest.newStars >= baseline * THRESHOLDS.cliff.dropRatio) return null

  return {
    kind: "star_cliff",
    severity: "down",
    period: latest.period,
    title: "新增 star 连续下降",
    // Lost stars, not the ratio: the ratio is capped by the threshold that
    // fired it, so every cliff reports roughly the same number and orders by
    // nothing. Absolute loss is what makes a 40k-star fall sort above a 30-star
    // one, which is the ordering §5.9.4 is asking for.
    magnitude: baseline - latest.newStars,
    metric: {
      baseline: baseline,
      latest: latest.newStars,
      ratio: round(baseline === 0 ? null : latest.newStars / baseline),
      dropRatio: THRESHOLDS.cliff.dropRatio,
      minimumBaseline: THRESHOLDS.cliff.minimumBaseline,
    },
    evidence: {
      series: seriesOf(window, "newStars"),
      notes: [
        `三周内从 ${baseline} 降到 ${latest.newStars}`,
        `早期基数 ${baseline} 需达到 ${THRESHOLDS.cliff.minimumBaseline} 才判`,
      ],
    },
  }
}

/**
 * 新增 star 相对三周前加速三倍以上，且绝对量够大。
 *
 * 这是唯一一个 `severity: "good"` 的规则，理由写在 §5.6：「我们也会说」——一个只会
 * 报坏消息的异动流会在两周内被无视，而增长加速是和断崖同一条时间轴上的同一个量，
 * 隐去它等于让读者自己心算。
 *
 * 绝对量门槛（50）是必要的：一个从 0 涨到 8 的项目是 3 倍，但那不是加速。
 */
export function detectStarAcceleration(subject: RadarSubject): RuleHit | null {
  const window = trailing(subject.weeks, THRESHOLDS.acceleration.weeks + 1)
  if (!window) return null

  const oldest = window[0]!
  const latest = window[window.length - 1]!
  if (latest.newStars < THRESHOLDS.acceleration.minimumLatest) return null

  // 基数接近 0 时倍数无意义：0 → 40 是「无穷倍」，按倍数报出来是胡说。
  if (
    oldest.newStars <
    THRESHOLDS.acceleration.minimumLatest / THRESHOLDS.acceleration.factor
  ) {
    return null
  }
  if (latest.newStars <= oldest.newStars * THRESHOLDS.acceleration.factor)
    return null

  return {
    kind: "star_acceleration",
    severity: "good",
    period: latest.period,
    // Same reasoning as the cliff, mirrored: the factor is pinned near the
    // threshold, so ordering by it would make every row look equally newsworthy.
    magnitude: latest.newStars - oldest.newStars,
    title: "新增 star 明显加速",
    metric: {
      baseline: oldest.newStars,
      latest: latest.newStars,
      factor: round(latest.newStars / oldest.newStars),
      factorThreshold: THRESHOLDS.acceleration.factor,
      minimumLatest: THRESHOLDS.acceleration.minimumLatest,
    },
    evidence: {
      series: seriesOf(window, "newStars"),
      notes: [
        `${oldest.label} 到 ${latest.label}：${oldest.newStars} → ${latest.newStars}`,
        `最新一周需达到 ${THRESHOLDS.acceleration.minimumLatest} 才报`,
      ],
    },
  }
}

/**
 * 距上次发布超过「两倍中位间隔」与「60 天」中较宽的那个。
 *
 * 取较宽者而不是较严者，是因为发布节奏本来就不该被当成合同：一个每周发版的小工具
 * 停两周不算出事，一个一年发一版的大库停三个月也不一定出事。用同一个天数去判两者，
 * 必然对其中一类过度报警，而过度报警的代价是被整体忽略。
 *
 * 中位间隔来自**按周聚合**的发布数，所以它是「发布周之间隔了几周」的近似而不是
 * 真实间隔天数。证据里因此只报两个数而不说「中位间隔 34.2 天」——那个精度是我们
 * 没有的。`metric.intervalIsApproximate` 就是为了让下游知道这一点。
 */
export function detectReleaseStall(subject: RadarSubject): RuleHit | null {
  const { lastReleaseAt } = subject
  if (!lastReleaseAt) return null

  const medianInterval = median(subject.releaseIntervalDays)
  const threshold = Math.max(
    THRESHOLDS.releaseStall.floorDays,
    (medianInterval ?? 0) * THRESHOLDS.releaseStall.intervalFactor
  )
  const daysSince = daysBetween(lastReleaseAt, subject.now)
  if (daysSince <= threshold) return null

  return {
    kind: "release_stall",
    severity: "risk",
    // Days of silence, so this orders against other stalls by how long they
    // have been quiet rather than by how far past the threshold they fell —
    // the threshold itself moves with each project's own release cadence.
    magnitude: daysSince,
    period: judgedPeriod(subject),
    title: "发布停滞",
    metric: {
      daysSinceLastRelease: daysSince,
      medianIntervalDays:
        medianInterval === null ? null : round(medianInterval),
      thresholdDays: round(threshold),
      floorDays: THRESHOLDS.releaseStall.floorDays,
      intervalFactor: THRESHOLDS.releaseStall.intervalFactor,
      intervalIsApproximate: medianInterval !== null,
    },
    evidence: {
      series: subject.weeks
        .slice(-THRESHOLDS.releaseStall.evidenceWeeks)
        .map((week) => ({
          label: week.label,
          value: String(week.releaseDelta ?? 0),
        })),
      notes: [
        `距上次发布 ${daysSince} 天`,
        medianInterval === null
          ? `无历史间隔可比，按下限 ${THRESHOLDS.releaseStall.floorDays} 天判`
          : `中位间隔约 ${Math.round(medianInterval)} 天 × ${THRESHOLDS.releaseStall.intervalFactor}`,
      ],
    },
  }
}

/**
 * 连续四周零提交，且 `pushed_at` 同样停在四周之前。
 *
 * 两个条件都必须满足，理由写在 {@link THRESHOLDS} 的 `commitStall.pushedFloorDays`
 * 上——它们是两条互相独立的证据，其中任何一条单独成立都可能是采样问题。
 */
export function detectCommitStall(subject: RadarSubject): RuleHit | null {
  const window = trailing(subject.weeks, THRESHOLDS.commitStall.weeks)
  if (!window) return null
  if (!hasNoCommitsFor(window, THRESHOLDS.commitStall.weeks)) return null

  const pushedDaysAgo = daysBetween(subject.pushedAt, subject.now)
  if (pushedDaysAgo < THRESHOLDS.commitStall.pushedFloorDays) return null

  return {
    kind: "commit_stall",
    severity: "notice",
    magnitude: pushedDaysAgo,
    period: window[window.length - 1]!.period,
    title: "连续四周无提交",
    metric: {
      weeksWithoutCommits: THRESHOLDS.commitStall.weeks,
      daysSincePush: pushedDaysAgo,
      pushedFloorDays: THRESHOLDS.commitStall.pushedFloorDays,
    },
    evidence: {
      series: window.map((week) => ({
        label: week.label,
        value: week.commitDelta === null ? "未测" : String(week.commitDelta),
      })),
      notes: [`距上次推送 ${pushedDaysAgo} 天`],
    },
  }
}

/**
 * 许可证与上一次观测到的不同。
 *
 * `severity: "risk"` 而不是 `down`：许可证不是「变差了」，它是「变了」，而 §5.4
 * 的红线 3 要求我们宁可多报也不要漏报——法务看到一条许可证变更会想去核实，看到
 * 一条「star 跌了」不会。同一条异动用 `down` 会让它和衰退混在一列里排序，而它们
 * 要的下一步动作完全不同。
 *
 * 没有上一次观测时不报：第一次看到某个仓库的许可证不是「变更」，把「我们刚开始
 * 记录」说成「它刚换过」是这条规则最容易犯也最不能犯的错。
 */
export function detectLicenseChange(subject: RadarSubject): RuleHit | null {
  const { license, previousLicense } = subject
  if (!license || !previousLicense || license === previousLicense) return null

  return {
    kind: "license_change",
    severity: "risk",
    // 0, deliberately. A licence change has no size: MIT to AGPL and MIT to
    // Apache-2.0 are the same event at different risk levels, and no numeric
    // ordering between them is defensible. Ordering these by a number would
    // imply a ranking of legal risk that nobody here is qualified to state.
    magnitude: 0,
    period: subject.licenseObservedAt ?? judgedPeriod(subject),
    title: "许可证变更",
    metric: {
      from: previousLicense,
      to: license,
      previousLicenseObservedAt: subject.previousLicenseObservedAt
        ? subject.previousLicenseObservedAt.toISOString()
        : null,
      daysSincePreviousObservation:
        subject.previousLicenseObservedAt === null
          ? null
          : daysBetween(subject.previousLicenseObservedAt, subject.now),
    },
    evidence: {
      notes: [
        `上次观测：${previousLicense}`,
        `本次观测：${license}`,
        "观测时间不等于变更时间，只说明雷达何时发现",
      ],
    },
  }
}

/** 全部规则，按「越坏越靠前」无关紧要——写入顺序不影响结果。 */
export const RULES: ReadonlyArray<(subject: RadarSubject) => RuleHit | null> = [
  detectStarCliff,
  detectStarAcceleration,
  detectReleaseStall,
  detectCommitStall,
  detectLicenseChange,
]

/**
 * 对一个仓库跑全部规则，返回命中的异动。
 *
 * 一次判定可能命中多条（比如 star 断崖同时发布停滞），它们是两条独立的事实，
 * 合成一条会丢掉其中一半的证据。
 */
export function evaluate(subject: RadarSubject): RuleHit[] {
  const hits: RuleHit[] = []
  for (const rule of RULES) {
    const hit = rule(subject)
    if (hit) hits.push(hit)
  }
  return hits
}

/** 四舍五入到两位小数，避免 `metric` 里出现 `0.6666666666666666`。 */
function round(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}
