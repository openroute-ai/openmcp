/**
 * 把 `lib/openapi/document.ts` 聚合出的 OpenAPI 文档，写成
 * `content/docs/api/` 下的逐端点 MDX 页面，按标签分成 `read/`、`write/` 与
 * `subscriptions/` 三个目录——侧栏的分组就是目录本身。
 *
 * 什么时候跑：加了新的 `/api/v1` 端点，或改了端点的路径 / 方法 / 说明。
 * 改字段或改响应体不用跑——页面按 id 现取文档，schema 一变它们就跟着变。
 *
 *   pnpm --filter console docs:openapi
 *
 * 目录里的 `meta.json`（标题、顺序）是手写的，所以 `meta: false`：生成器
 * 写出来的分组没有标题，而分组叫什么、先读哪个，是内容的事。
 *
 * 目录名用英文、`标签用中文，是刻意的：`content/docs/api/meta.json` 里的 `pages`
 * 直接写的就是这些目录名，它得稳定——改一次要同时改 meta.json，而标签是
 * 给人看的中文文案，改起来自由得多。
 */
import { basename } from "node:path"

import { generateFiles, type OutputFile } from "fumadocs-openapi"
import { createOpenAPI } from "fumadocs-openapi/server"

import { fumadocsDocument, navDescriptions } from "@/lib/openapi/document"

const document = fumadocsDocument()

const FOLDER_BY_TAG: Record<string, string> = {
  "读取 API": "read",
  "写入 API": "write",
  "订阅 API": "subscriptions",
  "扫描 API": "scan",
}

const NAV = navDescriptions()

/**
 * 把 `x-nav-description` 补进 frontmatter 的 `description`。
 *
 * fumadocs 的「上一页 / 下一页」把目标页的 frontmatter `description` 原样贴出来，
 * 而那一行只有半栏宽。散文塞进去会被 CSS 截成「日 / 周 / 月三种粒度的区间统计，
 * 默认最近 90 天。两条必须知道的行为…」，`**` 反引号、`§4.1` 这些只对通读正文
 * 才有意义的记号也会一起露出来。所以散文交给正文（`includeDescription`），导航
 * 交给这一行。
 *
 * 用 `beforeWrite` 而不是生成器的 `frontmatter` 回调：后者的上下文只有
 * `{ type: "operation" }`，没有 operationId，按 title 反查等于把稳定的
 * operationId 换成一句可能被人改掉的标题。文件名就是 operationId（与
 * `lib/docs/endpoints.ts` 同一个约定），所以直接拿它查 `NAV`，查不到就抛错。
 *
 * 只插一行，不重新序列化 YAML：`includeDescription` 为真时生成器压根不写
 * `description`（散文的活儿它交给了正文），所以这个位置必然是空的。插在 `title`
 * 那一行之后：frontmatter 的键序不影响语义，可这是要人读的文件，而这两行恰好是
 * 读者（和下一个改文案的人）会先看到的。
 */
function withNavDescription(file: OutputFile, nav: string): string {
  const end = file.content.indexOf("\n---\n")
  const banner = end === -1 ? "" : file.content.slice(0, end)

  if (!banner.startsWith("---\ntitle:") || /(^|\n)description:/.test(banner)) {
    throw new Error(`${file.path} 的 frontmatter 不是预期的形状`)
  }

  // `JSON.stringify` 而不是手写引号：概要里有 `/` 与 `§`，YAML 单引号串里的
  // `'` 要成对转义，少处理一个字符就是一份坏掉的 frontmatter。
  const line = `\ndescription: ${JSON.stringify(nav)}`
  const titleEnd = banner.indexOf("\n", "---\ntitle:".length)

  return `${banner.slice(0, titleEnd)}${line}${banner.slice(titleEnd)}${file.content.slice(end)}`
}

await generateFiles({
  input: createOpenAPI({ input: { radar: document } }),
  output: "content/docs/api",
  per: "operation",
  /**
   * 散文渲染进正文，而不是塞进 frontmatter。见 `withNavDescription` 那段。
   */
  includeDescription: true,
  groupBy: (entry) => {
    const operation =
      "path" in entry.item
        ? document.paths?.[entry.item.path]?.[entry.item.method]
        : undefined
    // 标签写错时落到 `read`，而不是丢掉这一页——分组名错了还能改，页面不见了
    // 只会让人以为端点没上线。
    return FOLDER_BY_TAG[operation?.tags?.[0] ?? ""] ?? "read"
  },
  meta: false,
  beforeWrite: (files) => {
    for (const file of files) {
      // 文件名去掉目录与后缀就是 operationId，与 `lib/docs/endpoints.ts` 同一个约定
      const nav = NAV.get(basename(file.path, ".mdx"))
      // 查不到就只可能是「文件名不再是 operationId」了（给 `generateFiles` 加了
      // `name`，或者换库改了命名）。查得到就等于每个页面都拿到了自己的概要。
      if (!nav) throw new Error(`${file.path} 在 navDescriptions() 里查不到`)

      file.content = withNavDescription(file, nav)
    }
  },
})
