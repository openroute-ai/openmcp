/**
 * `/docs` 的内容源：`content/docs` 下的 MDX 文件。
 *
 * 页面本身只负责「取哪一页、怎么排版」，每个字都来自那个目录 —— 与
 * `lib/openapi/document.ts` 的分工相反（那份是**结构化数据**，被逐端点页面和
 * `/llms-full.txt` 共用）。这里要的恰好是它给不了的东西：一段能被人读懂的
 * 接入说明，需要标题层级、示例、注意框，而那些放进一个 TS 对象里就只能拼字符串。
 *
 * `defineDocs` 来自 `fumadocs-mdx/macro`：MDX 在构建期由 next.config 里的
 * `createMDX()` 编译，宏在编译时把这个集合替换成真正的页面数据，所以这里的
 * `source` 是同步的——不需要 `getSource()`，也没有运行期扫描目录这一步。
 * 改一个字要重新构建，这是拿编译期类型与代码高亮换的；改完 `next dev` 自己
 * 会重编那一页。
 *
 * 没有 i18n：`/docs` 是中文的公开面，和 `/method`、`/faq` 一样（见
 * `components/public/public-shell.tsx` 顶上那段）。文件不带 locale 后缀，
 * `getPage` 也就不传语言。fumadocs 自己的 i18n 配置只用来本地化 UI 文案，
 * 见 `lib/docs/i18n.ts`。
 */
import { defineDocs } from "fumadocs-mdx/macro"
import { loader } from "fumadocs-core/source"

const docs = defineDocs({
  dir: "content/docs",
})

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
})

export type DocsSource = typeof source
export type DocsPage = DocsSource["$inferPage"]