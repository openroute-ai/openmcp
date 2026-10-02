import type { Metadata } from "next"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"

/**
 * API 文档 —— 四个公开端点，字段照着返回体写。
 *
 * 页面上的每个字段都对应 `/api/rankings/*.json`、`/api/anomalies.json` 里真实存在的
 * 键，而不是「我们希望它返回什么」。一份和实现不一致的文档比没有文档更贵：调用方会
 * 照着它写解析代码，然后在生产里发现字段不存在。所以这里的字段表是照着 handler 抄的，
 * 端点行为改了，文档必须跟着改。
 *
 * 没有鉴权、没有速率限制说明、没有 SDK——因为这三样目前都不存在。补上它们比写在这里
 * 更重要的是真的把它们加上，所以这一页宁可承认自己没有。
 */

export const metadata: Metadata = {
  title: siteTitle("API 文档"),
  description:
    "四个公开 JSON 端点：周榜、月榜、年度飙升榜、异动流。",
  alternates: { canonical: "/docs" },
  openGraph: {
    type: "website",
    title: siteTitle("API 文档"),
    description: "请求参数与返回字段。",
    url: siteUrl("/docs"),
  },
}

interface Endpoint {
  path: string
  title: string
  summary: string
  params: [string, string][]
  rows: [string, string, string][]
  note?: string
}

const ENDPOINTS: Endpoint[] = [
  {
    path: "/api/rankings/week.json",
    title: "周榜",
    summary:
      "ISO 周内星标绝对增量前 N，并同时给出相对增速的排序；默认是本周，可指定任意周。",
    params: [
      ["year", "ISO 周的年份，缺省为本周所在年。"],
      ["week", "ISO 周序号（1–53），缺省为本周。"],
      ["limit", "返回条数，默认 100。页面上的榜单截到 12，接口不限。"],
    ],
    rows: [
      ["trending[].fullName", "string", "`owner/name`，榜单的自然键。"],
      ["trending[].stars", "number", "周末时点的累计星标。"],
      ["trending[].delta", "number", "该周获得的星标数，可为负。"],
      ["trending[].relativeGrowth", "number | null", "增量除以期初星标；期初为 0 时是 null，不是 Infinity。"],
      ["trending[].anomaly", "object | null", "该仓库当期命中的异动，带触发时的阈值与证据。"],
      ["trending[].tags", "string[]", "从仓库 topics 归一化来的分类。"],
      ["trending[].logo / iconUrl / avatar", "string | null", "渲染列表需要的标记；都有 null 时回退到项目首字母。"],
      ["week", "string", "返回的 ISO 周标签，形如 `2026-W38`。"],
    ],
    note: "响应头 Cache-Control: public, max-age=0, s-maxage=3600——CDN 缓存一小时，客户端不缓存。",
  },
  {
    path: "/api/rankings/month.json",
    title: "月榜",
    summary: "字段与周榜完全一致，周期换成自然月。",
    params: [
      ["year", "年份，缺省为本月所在年。"],
      ["month", "月份（1–12），缺省为本月。"],
      ["limit", "返回条数，默认 100。"],
    ],
    rows: [
      ["trending[]", "同周榜", "字段名与含义都一样。"],
      ["month", "string", "`YYYY-MM`。"],
    ],
  },
  {
    path: "/api/rankings/rising-stars.json",
    title: "年度飙升榜",
    summary:
      "本年内星标绝对增量前 N，与周榜同结构。适合做年度回顾，不适合做「谁在被新发现」——后者看 relativeGrowth。",
    params: [
      ["year", "年份，缺省为当前年。"],
      ["limit", "返回条数，默认 100。"],
    ],
    rows: [
      ["trending[]", "同周榜", "字段名与含义都一样。"],
      ["year", "number", "返回的年份。"],
    ],
  },
  {
    path: "/api/anomalies.json",
    title: "异动流",
    summary:
      "命中判定规则的仓库，按「需要多快处理」排序：风险在前，其次是下行、提示，最后是好消息。",
    params: [
      ["week", "ISO 周，形如 `2026-W38`，缺省为本周。"],
      ["limit", "返回条数，默认 50。"],
      ["severity", "按级别过滤，取 `risk` / `down` / `notice` / `good`。"],
    ],
    rows: [
      ["anomalies[].severity", "string", "风险级别，也是排序键。"],
      ["anomalies[].kind", "string", "命中的规则标识，如 `star_cliff`、`release_stall`。"],
      ["anomalies[].magnitude", "number", "排序用的量级，含义随规则而变（断崖是丢失星数，停滞是天数，许可证变更是 0）。"],
      ["anomalies[].metric", "object", "触发时的完整读数：基数、最新值、阈值。"],
      ["anomalies[].evidence.series", "array", "判定用到的原始序列，`label` / `value` 对。"],
      ["anomalies[].evidence.notes", "string[]", "人读得懂的两三句，说明这次为什么算命中。"],
      ["week", "string", "返回的 ISO 周标签。"],
    ],
    note: "每条异动都带 metric 和 evidence：调用方不必回查判定代码就能复核这次为什么被判为命中。",
  },
]

export default function ApiDocsPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader
          title="API 文档"
          description="四个端点，无需鉴权。"
        />

        <div className="mt-8 grid gap-4">
          {ENDPOINTS.map((endpoint) => (
            <section
              key={endpoint.path}
              className="grid gap-4 rounded-2xl border border-border bg-card p-5"
            >
              <div className="grid gap-2">
                <h2 className="font-display text-lg font-bold tracking-tight">
                  {endpoint.title}
                </h2>
                <code className="w-fit rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                  GET {endpoint.path}
                </code>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {endpoint.summary}
                </p>
              </div>

              <div className="grid gap-3">
                <h3 className="text-sm font-semibold">请求参数</h3>
                <dl className="grid gap-2 text-sm">
                  {endpoint.params.map(([name, detail]) => (
                    <div key={name} className="flex flex-wrap gap-x-3">
                      <dt className="w-28 shrink-0 font-mono text-xs text-foreground">
                        {name}
                      </dt>
                      <dd className="min-w-0 flex-1 leading-relaxed text-muted-foreground">
                        {detail}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="grid gap-3">
                <h3 className="text-sm font-semibold">返回字段</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="w-64 py-2 pr-3 font-medium">字段</th>
                        <th className="w-40 py-2 pr-3 font-medium">类型</th>
                        <th className="py-2 font-medium">含义</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endpoint.rows.map(([field, type, detail]) => (
                        <tr
                          key={field}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="py-2 pr-3 align-top font-mono text-xs text-foreground">
                            {field}
                          </td>
                          <td className="py-2 pr-3 align-top font-mono text-xs text-muted-foreground">
                            {type}
                          </td>
                          <td className="py-2 align-top leading-relaxed text-muted-foreground">
                            {detail}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {endpoint.note ? (
                <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                  {endpoint.note}
                </p>
              ) : null}

              <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">试一下：</span>
                <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono">
                  curl {siteUrl(endpoint.path)}
                </code>
              </p>
            </section>
          ))}
        </div>

        <section className="mt-8 grid gap-2 rounded-2xl border border-border bg-card/60 p-5 text-sm leading-relaxed text-muted-foreground">
          <h2 className="font-display text-base font-bold tracking-tight text-foreground">
            现在还没有的东西
          </h2>
          <p>
            没有鉴权、没有速率限制、没有 SDK、没有稳定性承诺。这四项都是真实的产品决定，
            在补上之前写在这里比留白更安全——留白会被读成「大概有」。
          </p>
          <p>
            接口行为和页面同源：<LocaleLink
              href="/rankings"
              className="mx-1 underline underline-offset-2"
            >
              榜单页
            </LocaleLink>
            与 <code>/api/rankings/week.json</code> 由同一个 service 用同一个排序驱动，
            两者只可能在条数上不同。判定规则见{" "}
            <LocaleLink href="/method" className="mx-1 underline underline-offset-2">
              判定规则
            </LocaleLink>
            。
          </p>
        </section>
      </div>
    </PublicShell>
  )
}
