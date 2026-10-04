import { DocsLayout } from "fumadocs-ui/layouts/notebook"

import { DocsProvider } from "@/components/docs/provider"
import { baseOptions } from "@/lib/layout.shared"
import { source } from "@/lib/docs/source"

/**
 * `/docs` 的外壳：fumadocs 的导航、搜索与左栏。
 *
 * 放在 layout 而不是每一页里，是因为接下来的每一页都是一个 MDX 文件：让内容
 * 作者在每个文件顶部重复一次外壳，迟早会有一篇忘了，而忘掉的那篇看起来仍然
 * 正常 —— 只是没有导航。整站的导航与页脚只在这里声明一次。
 *
 * 树来自 `source.getPageTree()`：标题与顺序是 `content/docs` 下各层 `meta.json`
 * 说的，layout 不再抄一份，内容挪了位置侧栏跟着挪。
 *
 * 用 `fumadocs-ui/layouts/notebook` 而不是默认的 `layouts/docs`：notebook 是
 * docs 的紧凑版（更窄的正文、更小的导航），而 `/docs` 是接入文档，读者要的是
 * 一屏能看完一段说明，不是三栏铺开。它比默认版更「有主张」——侧栏与导航栏由它
 * 自己画，`baseOptions()` 只能给内容，给不了结构。
 *
 * 页面组件要从 `layouts/notebook/page` 导入（不是 `layouts/docs/page`），两边
 * 名字一样但不通用，见 `docs/[[...slug]]/page.tsx`。
 *
 * `DocsProvider`（fumadocs 的搜索与 UI 文案上下文）包在这里而不是根布局：
 * 用到它的只有文档路由，而它是个 client 组件，挂到整站会让每个页面都背一份。
 */
export default function DocsLayoutPage({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DocsProvider>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </DocsProvider>
  )
}