/**
 * 机器可读的接口契约：`GET /openapi.json`。
 *
 * 公开、无 key——同一份文档已经渲染在 `/docs/api/` 上，给它加一道门只会让
 * `curl` 用户多一次签发流程，换不到任何东西。文档里不含实例专属信息。
 *
 * `force-static`：内容来自代码与 schema，不随请求变化，构建一次即可。
 */
import { buildOpenAPIDocument } from "@/lib/openapi/document"

export const dynamic = "force-static"

export async function GET() {
  return Response.json(buildOpenAPIDocument(), {
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}
