import { THRESHOLDS } from "@/lib/radar/rules"

/**
 * The five rules, as prose, with every number interpolated from `THRESHOLDS`.
 *
 * Extracted from the `/method` page because it now has two homes: the page a
 * human reads, and `/llms-full.txt`, which is what an answer engine reads. The
 * failure this avoids is specific and not hypothetical — someone lowers
 * `cliff.dropRatio` to 0.5, the page quietly starts saying "四成以下" with a 0.5
 * behind it, and a quoted answer about how the radar decides what is a cliff is
 * wrong in a way no crawler can check. The rule the module follows is the same one
 * `lib/faq.ts` follows with the FAQ copy: a claim about a threshold lives in one
 * place, and the string that ends up on a page is built from the constant.
 *
 * The rule *rationale* — why three weeks and not two, why the release-stall
 * threshold is the looser of two bounds — stays in `rules.ts`, written for whoever
 * changes the code. This module carries the conclusion and the numbers, which is
 * what a reader needs and what an engine can quote.
 */

/**
 * One condition as a `[label, detail]` pair.
 *
 * A tuple rather than `{label, detail}` so the page can destructure it in the JSX
 * directly, which is what the original inline declaration did and what both
 * renderers already want to do.
 */
export type RuleCondition = [string, string]

export interface RuleCard {
  /** The `kind` as it appears in the JSON API. */
  kind: string
  title: string
  /** Severity in the feed's words, so a reader can match what they saw. */
  level: string
  summary: string
  /** Trigger conditions, one per line. */
  conditions: RuleCondition[]
  /** What ships in the anomaly's `evidence`. */
  evidence: string
}

/** Renders 0.4 the way a reader would say it. */
function ratio(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * Built per call rather than module scope: `THRESHOLDS` is a plain object and
 * could in principle be swapped by a test, and a card array frozen at import time
 * would then quote the old numbers with total confidence.
 */
export function ruleCards(): RuleCard[] {
  const accelerationFloor = Math.round(
    THRESHOLDS.acceleration.minimumLatest / THRESHOLDS.acceleration.factor
  )

  return [
    {
      kind: "star_cliff",
      title: "增速断崖",
      level: "下行",
      summary: "最近三周的新增 star 逐周不增，最新一周掉到三周前的四成以下。",
      conditions: [
        [
          "窗口",
          `最近 ${THRESHOLDS.cliff.weeks + 1} 周，其中后 ${THRESHOLDS.cliff.weeks} 周的新增逐周不增（相等也算下降）`,
        ],
        ["幅度", `最新一周不到最早一周的 ${ratio(THRESHOLDS.cliff.dropRatio)}`],
        [
          "基数下限",
          `最早一周至少 ${THRESHOLDS.cliff.minimumBaseline} 个新增 star`,
        ],
      ],
      evidence: "最近 4 周的周增量序列，以及触发时生效的阈值",
    },
    {
      kind: "star_acceleration",
      title: "异常加速",
      level: "好消息",
      summary:
        "最近一周的新增 star 超过三周前的三倍。级别是 good，在异动流里单独一栏。",
      conditions: [
        ["窗口", `最近 ${THRESHOLDS.acceleration.weeks + 1} 周`],
        [
          "倍数",
          `最新一周超过 ${THRESHOLDS.acceleration.weeks} 周前的 ${THRESHOLDS.acceleration.factor} 倍`,
        ],
        [
          "绝对量下限",
          `最新一周至少 ${THRESHOLDS.acceleration.minimumLatest} 个新增 star，${THRESHOLDS.acceleration.weeks} 周前至少 ${accelerationFloor} 个`,
        ],
      ],
      evidence: "最近 4 周的周增量序列，以及本次的倍数和两个绝对量",
    },
    {
      kind: "release_stall",
      title: "维护停滞",
      level: "风险",
      summary:
        "距上次发布超过门槛。每个项目的门槛不一样，跟它自己的发布节奏走。",
      conditions: [
        [
          "门槛",
          `距上次发布超过「${THRESHOLDS.releaseStall.floorDays} 天」与「中位发布间隔 × ${THRESHOLDS.releaseStall.intervalFactor}」中较宽的那个`,
        ],
        ["中位间隔", "按周聚合的发布数算，是发布周之间隔的近似值"],
      ],
      evidence: `最近 ${THRESHOLDS.releaseStall.evidenceWeeks} 周的发布数，以及本次生效的门槛天数`,
    },
    {
      kind: "commit_stall",
      title: "推送停滞",
      level: "提示",
      summary: "连续四周没有提交，pushed_at 同样停在四周之前。",
      conditions: [
        ["提交", `连续 ${THRESHOLDS.commitStall.weeks} 周提交数为 0`],
        [
          "推送",
          `pushed_at 距今至少 ${THRESHOLDS.commitStall.pushedFloorDays} 天`,
        ],
        [
          "两个条件缺一不可",
          "提交数为 0 也可能是没采到；pushed_at 是另一条独立证据",
        ],
      ],
      evidence: "这 4 周的提交数（未采到的周标「未测」），以及距上次推送的天数",
    },
    {
      kind: "license_change",
      title: "许可证变更",
      level: "风险",
      summary: "和上次观测到的许可证不同。这条没有量级，排序时不参与比较。",
      conditions: [
        ["触发", "本次观测到的许可证与上一次不同"],
        ["不报的情况", "第一次观测到这个仓库的许可证"],
      ],
      evidence: "上次观测、本次观测，以及两次观测之间隔了多久",
    },
  ]
}
