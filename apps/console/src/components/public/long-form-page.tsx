import { PublicPageHeader, PublicShell } from "@/components/public/public-shell"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 长文的排版：一个窄栏 + 一套段落样式。
 *
 * 窄栏是因为这些页面（选型指南、关于我们、四份法务文本）是要读完的，不是扫完的；
 * 段落样式集中在这里而不是散在每个页面的 className 里，是为了让「隐私政策的第一段」
 * 和「选型指南的第一段」在排版上完全一样——同一批页面的正文字号一旦有第二种写法，
 * 读者会以为内容本身也有轻重之分。
 */
export function Prose({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid gap-4 text-sm leading-relaxed text-muted-foreground",
        "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:no-underline",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground",
        "[&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h2:first-child]:mt-0",
        "[&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-foreground",
        "[&_li]:list-disc [&_li]:pl-1 [&_li::marker]:text-muted-foreground/60",
        "[&_ol]:grid [&_ol]:gap-2 [&_ol]:pl-5 [&_ol]:list-decimal",
        "[&_strong]:font-medium [&_strong]:text-foreground",
        "[&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground",
        "[&_ul]:grid [&_ul]:gap-2 [&_ul]:pl-5",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * 一个长文页面的骨架：公共外壳 + 页头 + 窄栏正文 + 页脚注。
 *
 * `updated` 与 `footerNote` 是给法务四页准备的——一份会变的文本必须自己说出它上次是
 * 什么时候变的，否则读者无法判断手里这份是第几版。
 */
export function LongFormPage({
  title,
  description,
  updated,
  headerExtra,
  footerNote,
  children,
}: {
  title: string
  description: string
  /** 例如 `2026-10-02`，渲染成「最后更新」。 */
  updated?: string
  /** 页头右侧的槽位，与 `PublicPageHeader` 的 children 一致。 */
  headerExtra?: React.ReactNode
  /** 正文之后的说明，默认是「最后更新」。 */
  footerNote?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <PublicPageHeader title={title} description={description}>
          {headerExtra}
        </PublicPageHeader>

        <article className="mx-auto mt-8 max-w-3xl">
          <Prose>{children}</Prose>
        </article>

        <div className="mx-auto mt-10 max-w-3xl border-t border-border pt-4 text-xs text-muted-foreground">
          {footerNote ?? (updated ? <>最后更新 {updated}</> : null)}
        </div>
      </div>
    </PublicShell>
  )
}