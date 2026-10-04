import { operationRef, type OperationRef } from "@/lib/openapi/document"

export type { OperationRef }

/**
 * `/docs/api/**` 下的一页就是一个 operation：文件名即 operationId（生成器
 * 按 operationId 命名文件）。其余页面是散文，没有对应的端点。
 *
 * 传 URL 而不是 slugs，是因为侧栏拿到的是页面树节点的 `url`，页面拿到的
 * `page.url` 也一样——两边同一个判断，不会出现侧栏带徽标、页首不带。
 */
export function endpointForPath(url: string): OperationRef | undefined {
  if (!url.startsWith("/docs/api/")) return undefined
  const id = url.split("/").pop()
  return id ? operationRef(id) : undefined
}
