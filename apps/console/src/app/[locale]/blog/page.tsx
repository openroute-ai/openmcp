import type { Metadata } from "next"

import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { LocaleLink } from "@/i18n/navigation"
import { listPosts } from "@/lib/blog"

/**
 * 博客列表。
 *
 * 列表页不假设有文章：`listPosts()` 读到空目录时返回空数组，这里显示自己的空态。
 * 「还没有文章」比「加载中」或一片空白更接近真相——一篇都没有是当前的状态，不是错误。
 */

export const metadata: Metadata = {
  title: "博客 — OpenMCP 雷达",
  description:
    "判定方法、数据口径，以及星标回答不了的问题。",
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: "博客 — OpenMCP 雷达",
    description: "判定方法与数据口径。",
    url: "https://radar.openmcp.cn/blog",
  },
}

export default function BlogIndexPage() {
  const posts = listPosts()

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <PublicPageHeader
          title="博客"
          description="判定方法、数据口径，和星标回答不了的问题。写得出才发。"
        />

        {posts.length === 0 ? (
          <p className="mt-8 rounded-2xl border border-border bg-card/60 px-5 py-8 text-center text-sm leading-relaxed text-muted-foreground">
            还没有文章。
            <br />
            方法与口径目前都在{" "}
            <LocaleLink href="/method" className="underline underline-offset-2">
              判定规则
            </LocaleLink>{" "}
            和{" "}
            <LocaleLink href="/guide" className="underline underline-offset-2">
              选型指南
            </LocaleLink>{" "}
            里，不急着开张。
          </p>
        ) : (
          <div className="mt-8 grid gap-4">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="grid gap-2 rounded-2xl border border-border bg-card p-5 transition-colors hover:bg-accent/40"
              >
                <LocaleLink
                  href={`/blog/${post.slug}`}
                  className="font-display text-lg font-bold tracking-tight hover:underline"
                >
                  {post.title}
                </LocaleLink>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={post.date}>{post.date}</time>
                  {post.tags.length > 0 ? ` · ${post.tags.join(" · ")}` : null}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {post.excerpt}
                </p>
                <LocaleLink
                  href={`/blog/${post.slug}`}
                  className="w-fit text-sm text-foreground underline underline-offset-2"
                >
                  读全文
                </LocaleLink>
              </article>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  )
}
