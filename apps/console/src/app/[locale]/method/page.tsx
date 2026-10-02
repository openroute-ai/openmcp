import type { Metadata } from "next"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"
import { siteTitle, siteUrl } from "@/lib/config/site"
import { ruleCards } from "@/lib/docs/radar-rules"

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
 *
 * 卡片本身放在 `lib/docs/radar-rules.ts`，因为 `/llms-full.txt` 要输出同一份规则——
 * 引擎回答「它怎么判断断崖」时读的是那一份。两份同源，所以下界从 0.4 改成 0.5
 * 时，两个地方不可能只有一个变。
 */

export const metadata: Metadata = {
  title: siteTitle("判定规则"),
  description:
    "五条判定规则：增速断崖、异常加速、维护停滞、推送停滞、许可证变更。",
  alternates: { canonical: "/method" },
  openGraph: {
    type: "website",
    title: siteTitle("判定规则"),
    description: "每条规则的窗口、倍数和下限。",
    url: siteUrl("/method"),
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
          <h2 className="font-display text-lg font-bold tracking-tight">
            约定
          </h2>
          <ul className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
            <li className="list-disc pl-1">
              红 = 涨 / 加速，绿 = 跌 /
              衰退。风险类不用颜色表示，用图标和标签文字。
            </li>
            <li className="list-disc pl-1">
              每条规则都有绝对量下限，只有相对量的项目不进榜。
            </li>
            <li className="list-disc pl-1">
              每条异动带 metric 和 evidence，可以自己核对这次为什么算命中。
            </li>
          </ul>
        </section>

        <p className="mt-8 text-xs text-muted-foreground">
          判定与原始数据见 <code>/api/anomalies.json</code>
          ，里面带每条异动触发时生效的 阈值；
          <LocaleLink
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
