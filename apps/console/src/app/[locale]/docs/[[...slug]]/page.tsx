import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page"
import { createRelativeLink } from "fumadocs-ui/mdx"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { DescriptionMarkdown } from "@/components/docs/description-markdown"
import { MethodBadge } from "@/components/docs/method-badge"
import { JsonLd } from "@/components/seo/json-ld"
import { SITE_NAME, siteTitle, siteUrl } from "@/lib/config/site"
import { endpointForPath } from "@/lib/docs/endpoints"
import { source } from "@/lib/docs/source"
import { apiDocsNode, breadcrumbNode } from "@/lib/seo/structured-data"
import { getMDXComponents } from "@/mdx-components"

/**
 * `/docs` —— fumadocs 渲染的接入文档。
 *
 * 一页 = `content/docs` 下的一个 MDX 文件。页面只做几件事：按 slug 找到文件、
 * 用 `DocsPage` / `DocsTitle` / `DocsBody` 把它排进 fumadocs 的布局、把它的标题
 * 层级交给右侧目录。**正文里没有一句是写死在 JSX 里的** —— 会变的契约（参数、
 * 字段、状态码）一部分在 MDX 里，一部分来自 `lib/openapi/document`，两处都不在
 * 这里。
 *
 * 为什么不是上一版那种手写表格：手写的表格能和实现漂移，而且只能检查「读起来
 * 对不对」。现在端点页的字段表来自与 `/llms-full.txt` 同一份 OpenAPI 文档，
 * 散文来自可以逐句改的 MDX，两边各自的检查方式都还在。
 *
 * MDX 在构建期编译（`fumadocs-mdx`），所以 `body` 是一个组件而不是一段等着
 * 现编译的源码：直接渲染它，并把组件表交给它。`a` 换成 `createRelativeLink`
 * 之后内容里可以写相对路径的链接（`./api-keys`），内容挪位置时链接跟着走。
 *
 * **这里没有 `generateStaticParams`**，而 console 的其他页面也没有。locale 是
 * 动态段（`[locale]`，由 proxy 改写），它自己没有 params 可枚举，于是这一页
 * 根本没法在构建期生成具体 URL。声明 `source.generateParams()` 反而更糟：Next
 * 会因为「有 generateStaticParams」把这条路由标成静态（构建产物里是 `●`），却在
 * 渲染时读到请求数据（根布局的 next-intl messages），静态路径上直接抛
 * `DYNAMIC_SERVER_USAGE`，`/docs` 整页 500。内容是构建期就编译好的静态资源，
 * 但它的 URL 由请求决定——这两件事在这里必须一起说，否则路由类型就是错的。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}): Promise<Metadata> {
  const { slug } = await params
  const page = source.getPage(slug ?? [])
  if (!page) return {}

  const path =
    page.slugs.length > 0 ? `/docs/${page.slugs.join("/")}` : "/docs"

  const description = plainDescription(page.data.description)

  return {
    title: siteTitle(page.data.title),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title: siteTitle(page.data.title),
      description,
      url: siteUrl(path),
    },
  }
}

/**
 * metadata 是纯文本，而 frontmatter 里的描述是 markdown（生成的端点页会写
 * `**强调**` 和 `` `代码` ``）——原样塞进 `<meta>` 只会把搜索摘要和分享卡片
 * 弄花。正文的强调由 `DescriptionMarkdown` 负责，这里只管去掉记号。
 */
function plainDescription(markdown: string | undefined): string | undefined {
  return markdown?.replace(/\*\*?|`/g, "").replace(/\s+/g, " ").trim()
}

/**
 * 逐端点页面在标题下面补一行「方法 + 路径」。
 *
 * `content/docs/api/**` 下的一页就是一个 operation，文件名即 operationId，
 * 所以拿 URL 就能在 `lib/openapi/document` 里对回它自己（见
 * `lib/docs/endpoints.ts`）。散文页对不上，返回 `undefined`，于是这行不出现。
 *
 * 以前这行信息在左栏的每一项上。换成 fumadocs 的侧栏之后那套自定义条目没有
 * 落点了，但信息本身该留在页面上：读者常常是从 `/docs/api/` 的目录点进来的，
 * 落点页第一屏就该说清自己讲的是哪个接口。
 */
function EndpointLine({ url }: { url: string }) {
  const endpoint = endpointForPath(url)
  if (!endpoint) return null

  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      <MethodBadge method={endpoint.method} />
      <code className="truncate font-mono text-xs text-muted-foreground">
        {endpoint.path}
      </code>
    </div>
  )
}

export default async function DocsPageRoute({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug } = await params
  const page = source.getPage(slug ?? [])
  if (!page) notFound()

  const MDX = page.data.body
  const isIndex = page.slugs.length === 0

  return (
    <>
      {isIndex ? (
        <JsonLd
          node={[
            apiDocsNode(),
            breadcrumbNode([
              { name: SITE_NAME, path: "/" },
              { name: "API 文档", path: "/docs" },
            ]),
          ]}
        />
      ) : null}

      <DocsPage toc={page.data.toc} full={page.data.full}>
        <DocsTitle>{page.data.title}</DocsTitle>
        {page.data.description ? (
          <DocsDescription>
            <DescriptionMarkdown text={page.data.description} />
          </DocsDescription>
        ) : null}

        <EndpointLine url={page.url} />

        <DocsBody>
          <MDX
            components={getMDXComponents({
              // 内容里的相对链接（`./api-keys`）据此解析成真实路径。
              a: createRelativeLink(source, page),
            })}
          />
        </DocsBody>
      </DocsPage>
    </>
  )
}