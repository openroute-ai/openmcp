import type { Metadata } from "next"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { JsonLd } from "@/components/seo/json-ld"
import { LocaleLink } from "@/i18n/navigation"
import {
  DOCS_ORIGIN,
  docsUrl,
  SITE_NAME,
  siteTitle,
  siteUrl,
} from "@/lib/config/site"
import {
  PUBLIC_API_ENDPOINTS,
  RANKED_PROJECT_FIELDS,
} from "@/lib/docs/public-api"
import { apiDocsNode, breadcrumbNode } from "@/lib/seo/structured-data"

/**
 * 公开 API —— 四个匿名端点，字段照着返回体写。
 *
 * 页面上的每个字段都来自 `lib/docs/public-api` 里的一份数据，而不是写死在 JSX
 * 里；那份数据同时喂给 `/llms-full.txt`。原因很直接：一份和实现不一致的文档比没有
 * 文档更贵——调用方会照着它写解析代码，然后在生产里发现字段不存在。把描述放在唯一
 * 一处、被页面和给 agent 的那份文本共用，端点改了而文档没跟上这件事就会在下一次渲染
 * 时立刻暴露，而不是等到某个调用方报障。
 *
 * 这里只写四个端点，因为只有这四个不需要凭据。它们之外的一切——机器对机器的写入
 * API、调度器、技能导出、API key 与权限范围——写在长文档站
 * （{@link DOCS_ORIGIN}），那里才是它们的读者会去的地方，而把 `CRON_SECRET` 的用法
 * 放进一个会被爬虫索引的页面，只会让那页同时变成注册表单的邻居。
 */

export const metadata: Metadata = {
  title: siteTitle("API 文档"),
  description:
    "四个公开 JSON 端点：周榜、月榜、年度飙升榜、异动流。请求参数、返回字段与错误码。",
  alternates: { canonical: "/docs" },
  openGraph: {
    type: "website",
    title: siteTitle("API 文档"),
    description: "请求参数与返回字段。",
    url: siteUrl("/docs"),
  },
}

export default function ApiDocsPage() {
  return (
    <PublicShell>
      <JsonLd
        node={[
          apiDocsNode(),
          breadcrumbNode([
            { name: SITE_NAME, path: "/" },
            { name: "API 文档", path: "/docs" },
          ]),
        ]}
      />
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader title="API 文档" description="四个端点，无需鉴权。">
          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href={siteUrl("/llms-full.txt")}
              className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              llms-full.txt（给 AI 读的同一份）
            </a>
            <a
              href={docsUrl("/docs/console-api")}
              className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              需要凭据的接口 → 完整 API 参考
            </a>
          </div>
        </PublicPageHeader>

        <div className="mt-8 grid gap-4">
          {PUBLIC_API_ENDPOINTS.map((endpoint) => (
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

              {endpoint.params.length > 0 ? (
                <div className="grid gap-3">
                  <h3 className="text-sm font-semibold">请求参数</h3>
                  <dl className="grid gap-2 text-sm">
                    {endpoint.params.map((param) => (
                      <div key={param.name} className="flex flex-wrap gap-x-3">
                        <dt className="w-28 shrink-0 font-mono text-xs text-foreground">
                          {param.name}
                        </dt>
                        <dd className="min-w-0 flex-1 leading-relaxed text-muted-foreground">
                          <span className="font-mono text-xs text-muted-foreground/80">
                            {param.type}
                          </span>
                          <span className="mx-2">—</span>
                          {param.detail}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

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
                      {endpoint.fields.map((field) => (
                        <tr
                          key={field.path}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="py-2 pr-3 align-top font-mono text-xs text-foreground">
                            {field.path}
                          </td>
                          <td className="py-2 pr-3 align-top font-mono text-xs text-muted-foreground">
                            {field.type}
                          </td>
                          <td className="py-2 align-top leading-relaxed text-muted-foreground">
                            {field.detail}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {endpoint.errors.length > 0 ? (
                <div className="grid gap-3">
                  <h3 className="text-sm font-semibold">错误响应</h3>
                  <ul className="grid gap-1.5 text-sm text-muted-foreground">
                    {endpoint.errors.map((error) => (
                      <li key={error.status} className="flex flex-wrap gap-x-3">
                        <span className="w-12 shrink-0 font-mono text-xs text-foreground">
                          {error.status}
                        </span>
                        <span className="min-w-0 flex-1 leading-relaxed">
                          {error.when}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

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

        <section className="mt-8 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold tracking-tight">
            榜单条目的字段
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            周榜与月榜的 <code>trending[]</code> 和{" "}
            <code>byRelativeGrowth[]</code> 里是同一种记录，字段如下：
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="w-64 py-2 pr-3 font-medium">字段</th>
                  <th className="w-40 py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 font-medium">含义</th>
                </tr>
              </thead>
              <tbody>
                {RANKED_PROJECT_FIELDS.map((field) => (
                  <tr
                    key={field.path}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2 pr-3 align-top font-mono text-xs text-foreground">
                      {field.path}
                    </td>
                    <td className="py-2 pr-3 align-top font-mono text-xs text-muted-foreground">
                      {field.type}
                    </td>
                    <td className="py-2 align-top leading-relaxed text-muted-foreground">
                      {field.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 grid gap-2 rounded-2xl border border-border bg-card/60 p-5 text-sm leading-relaxed text-muted-foreground">
          <h2 className="font-display text-base font-bold tracking-tight text-foreground">
            现在还没有的东西
          </h2>
          <p>
            没有鉴权、没有速率限制、没有
            SDK、没有稳定性承诺。这四项都是真实的产品决定，
            在补上之前写在这里比留白更安全——留白会被读成「大概有」。
          </p>
          <p>
            接口行为和页面同源：
            <LocaleLink
              href="/rankings"
              className="mx-1 underline underline-offset-2"
            >
              榜单页
            </LocaleLink>
            与 <code>/api/rankings/week.json</code> 由同一个 service
            用同一个排序驱动， 两者只可能在条数上不同。判定规则见{" "}
            <LocaleLink
              href="/method"
              className="mx-1 underline underline-offset-2"
            >
              判定规则
            </LocaleLink>
            。
          </p>
          <p>
            需要凭据的接口（<code>POST /api/internal/repos</code>
            、调度器、技能导出、 API key 与权限范围）写在完整 API 参考里：
            <a
              href={docsUrl("/docs/console-api")}
              className="mx-1 underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              {DOCS_ORIGIN}/docs/console-api
            </a>
          </p>
        </section>
      </div>
    </PublicShell>
  )
}
