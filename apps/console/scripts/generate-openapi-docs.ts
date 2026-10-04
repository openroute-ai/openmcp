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
import { generateFiles } from "fumadocs-openapi"
import { createOpenAPI } from "fumadocs-openapi/server"
import { fumadocsDocument } from "@/lib/openapi/document"

const document = fumadocsDocument()

const FOLDER_BY_TAG: Record<string, string> = {
  "读取 API": "read",
  "写入 API": "write",
  "订阅 API": "subscriptions",
}

await generateFiles({
  input: createOpenAPI({ input: { radar: document } }),
  output: "content/docs/api",
  per: "operation",
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
})
