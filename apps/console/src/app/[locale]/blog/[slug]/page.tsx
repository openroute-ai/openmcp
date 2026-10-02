import type { Metadata } from "next"

import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { notFound } from "next/navigation"

import { siteTitle, siteUrl } from "@/lib/config/site"
import { Prose } from "@/components/public/long-form-page"
import { JsonLd } from "@/components/seo/json-ld"
import { PublicShell } from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"
import { getPost, listPosts } from "@/lib/blog"
import { SITE_NAME } from "@/lib/config/site"
import { articleNode, breadcrumbNode } from "@/lib/seo/structured-data"

/**
 * 一篇文章。
 *
 * 构建期渲染，参数就是 `content/blog` 里的文件名：`dynamicParams = false` 让未知 slug
 * 直接 404，而不是渲染一个「文章不存在」的空页——一个能被构造出来的 URL 拿到 200，
 * 对搜索引擎和爬虫来说就是把垃圾 URL 收进索引。
 *
 * Markdown 不走 `rehype-raw`：这里的文件是自己仓库里的，不是第三方 README，没有理由让
 * 原始 HTML 参与渲染。正文里出现的链接照原样渲染，其中站内链接用普通 `<a>` 就够——
 * 路由的默认语言不带前缀，`/method` 本身就是有效 URL。
 */

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slug }))
}

export const dynamicParams = false

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const post = getPost((await params).slug)
  if (!post) return { title: siteTitle("文章不存在") }
  return {
    title: siteTitle(`${post.title}`),
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: siteTitle(`${post.title}`),
      description: post.excerpt,
      publishedTime: post.date,
      url: siteUrl(`/blog/${post.slug}`),
    },
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const post = getPost((await params).slug)
  if (!post) notFound()

  return (
    <PublicShell>
      <JsonLd
        node={[
          articleNode({
            title: post.title,
            description: post.excerpt,
            date: post.date,
            slug: post.slug,
          }),
          breadcrumbNode([
            { name: SITE_NAME, path: "/" },
            { name: "博客", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
        ]}
      />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <LocaleLink
          href="/blog"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← 博客
        </LocaleLink>

        <article className="mt-6 grid gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {post.title}
          </h1>
          <p className="text-xs text-muted-foreground">
            <time dateTime={post.date}>{post.date}</time>
            {post.tags.length > 0 ? ` · ${post.tags.join(" · ")}` : null}
          </p>

          <div className="mt-4 border-t border-border pt-6">
            <Prose>
              <Markdown remarkPlugins={[remarkGfm]}>{post.body}</Markdown>
            </Prose>
          </div>
        </article>
      </div>
    </PublicShell>
  )
}
