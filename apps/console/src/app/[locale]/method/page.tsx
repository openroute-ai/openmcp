import type { Metadata } from "next"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"
import { THRESHOLDS } from "@/lib/radar/rules"

/**
 * 判定规则 —— 页面上写的每个数都从这里来。
 *
 * 这一页存在的理由是它不写死任何数字：卡片里的阈值直接读 `lib/radar/rules.ts` 的
 * `THRESHOLDS`，改阈值的人不必记得回来改文案，而一个和代码不同步的规则页比没有规则
 * 页更糟——它会让读者按着错的数做决策，并且还显得比系统更权威。
 *
 * 规则本身为什么这么定（为什么「三周不增」而不是「两周」、为什么发布停滞取较宽的
 * 门槛）写在 `rules.ts` 每条规则的注释里。那是给改代码的人看的，所以这里只讲结论和
 * 门槛；要理由的读者在文末拿得到。
 */

export const dynamic = "force-dynamic"

/** 把 0.4 这类阈值写成读者会念出来的样子。 */
function ratio(value: number): string {
  return `${Math.round(value * 100)}%`
}

interface RuleCard {
  kind: string
  title: string
  /** 严重程度，用词与异动流一致。 */
  level: string
  summary: string
  /** 触发条件，逐条读。 */
  conditions: [string, string][]
  /** 证据里会附什么。 */
  evidence: string
}

/**
 * 一条规则一张卡：门槛、条件、证据，全部读自 `THRESHOLDS`。
 */
function ruleCards(): RuleCard[] {
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
        [
          "幅度",
          `最新一周不到最早一周的 ${ratio(THRESHOLDS.cliff.dropRatio)}`,
        ],
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
      summary: "最近一周的新增 star 超过三周前的三倍。级别是 good，在异动流里单独一栏。",
      conditions: [
        [
          "窗口",
          `最近 ${THRESHOLDS.acceleration.weeks + 1} 周`,
        ],
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
      summary: "距上次发布超过门槛。每个项目的门槛不一样，跟它自己的发布节奏走。",
      conditions: [
        [
          "门槛",
          `距上次发布超过「${THRESHOLDS.releaseStall.floorDays} 天」与「中位发布间隔 × ${THRESHOLDS.releaseStall.intervalFactor}」中较宽的那个`,
        ],
        [
          "中位间隔",
          "按周聚合的发布数算，是发布周之间隔的近似值",
        ],
      ],
      evidence: `最近 ${THRESHOLDS.releaseStall.evidenceWeeks} 周的发布数，以及本次生效的门槛天数`,
    },
    {
      kind: "commit_stall",
      title: "推送停滞",
      level: "提示",
      summary: "连续四周没有提交，pushed_at 同样停在四周之前。",
      conditions: [
        [
          "提交",
          `连续 ${THRESHOLDS.commitStall.weeks} 周提交数为 0`,
        ],
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
        [
          "不报的情况",
          "第一次观测到这个仓库的许可证",
        ],
      ],
      evidence: "上次观测、本次观测，以及两次观测之间隔了多久",
    },
  ]
}

export const metadata: Metadata = {
  title: "判定规则 — OpenMCP 雷达",
  description:
    "五条判定规则：增速断崖、异常加速、维护停滞、推送停滞、许可证变更。",
  alternates: { canonical: "/method" },
  openGraph: {
    type: "website",
    title: "判定规则 — OpenMCP 雷达",
    description: "每条规则的窗口、倍数和下限。",
    url: "https://radar.openmcp.cn/method",
  },
}

export default function MethodPage() {
  const cards = ruleCards()

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="判定规则"
          description="异动是这五条规则跑出来的。"
        >
          <LocaleLink
            href="/anomalies"
            className="rounded-lg border border-border px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            看异动
          </LocaleLink>
        </PublicPageHeader>

        <div className="mt-8 grid gap-4">
          {cards.map((card) => (
            <section
              key={card.kind}
              className="grid gap-3 rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-display text-lg font-bold tracking-tight">
                  {card.title}
                </h2>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {card.kind}
                </code>
                <span className="ml-auto text-xs text-muted-foreground">
                  级别：{card.level}
                </span>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground">
                {card.summary}
              </p>

              <dl className="grid gap-2 text-sm">
                {card.conditions.map(([label, detail]) => (
                  <div key={label} className="flex flex-wrap gap-x-3">
                    <dt className="w-28 shrink-0 text-xs text-muted-foreground">
                      {label}
                    </dt>
                    <dd className="min-w-0 flex-1 leading-relaxed text-foreground">
                      {detail}
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                证据：{card.evidence}
              </p>
            </section>
          ))}
        </div>

        <section className="mt-10 grid gap-3 rounded-2xl border border-border bg-card/60 p-5">
          <h2 className="font-display text-lg font-bold tracking-tight">约定</h2>
          <ul className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
            <li className="list-disc pl-1">红 = 涨 / 加速，绿 = 跌 / 衰退。风险类不用颜色表示，用图标和标签文字。</li>
            <li className="list-disc pl-1">每条规则都有绝对量下限，只有相对量的项目不进榜。</li>
            <li className="list-disc pl-1">每条异动带 metric 和 evidence，可以自己核对这次为什么算命中。</li>
          </ul>
        </section>

        <p className="mt-8 text-xs text-muted-foreground">
          判定与原始数据见 <code>/api/anomalies.json</code>，里面带每条异动触发时生效的
          阈值；<LocaleLink
            href="/guide"
            className="mx-1 underline underline-offset-2"
          >
            选型指南
          </LocaleLink>
          里是这些数怎么用。
        </p>
      </div>
    </PublicShell>
  )
}