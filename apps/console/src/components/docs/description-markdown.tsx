"use client"

import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * 把 frontmatter 的 `description` 压成一段行内 markdown 再渲染。
 *
 * 描述里本来就有 `**不发布**`、`代码` 这样的记号，直接当字符串渲染会把记号
 * 原样显示给读者，所以要走 markdown；但 markdown 默认会把段落包进 `<p>`，而
 * fumadocs 的 `DocsDescription` 已经把整段描述放进了一个 `<p>`——于是任何块级
 * 元素（`<ul>` / `<ol>` / 表格）都成了 `<p>` 的后代，HTML 不允许，React 会报
 * hydration 错误。拆掉段落标签只解决了一半：块级元素仍然是 `<p>` 的后代。
 *
 * 所以这里在**解析之前**就把描述压成一行：换行折成空格，行首的列表、引用、标题
 * 标记去掉。剩下的全是行内节点，放进 `<p>` 里合法。描述本来就只该是一句话，
 * 一句话里出现列表说明写错了地方——该写成正文页，而不是塞进摘要。
 *
 * `react-markdown` 内部用了 hook，这一层必须是客户端组件——描述只有一句，多一个
 * 边界不值得为它换成手写解析。
 */
function toInline(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|&gt;\s*)+/, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

export function DescriptionMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{ p: ({ children }) => <>{children}</> }}
    >
      {toInline(text)}
    </Markdown>
  )
}