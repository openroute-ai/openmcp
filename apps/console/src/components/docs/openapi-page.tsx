/**
 * 生成出来的 per-operation MDX 页用的 `<OpenAPIPage />`。
 *
 * 那些页面的 default export 只写了一句 `props.components.OpenAPIPage`，拿到的
 * props 是 `document` + `operations`。文档本身不进 MDX 文件：这里按 id 现取
 * （`lib/openapi/document.ts`，与 `/openapi.json` 同一份），再以 `payload` 交给
 * 客户端组件。这样 schema 改了，页面跟着改，不需要重新生成任何文件。
 */
import type { OperationItem } from "fumadocs-openapi"
import { createOpenAPI } from "fumadocs-openapi/server"
import { fumadocsDocument } from "@/lib/openapi/document"
import { OpenAPIPageClient } from "./openapi-client"

const api = createOpenAPI({
  input: { radar: () => fumadocsDocument() },
})

type Props = {
  document?: string
  operations?: OperationItem[]
  showTitle?: boolean
  showDescription?: boolean
}

export async function OpenAPIPage(props: Props) {
  const { bundled } = await api.getSchema(props.document ?? "radar")

  return (
    <OpenAPIPageClient
      payload={{ bundled }}
      operations={props.operations}
      showTitle={props.showTitle}
      showDescription={props.showDescription}
    />
  )
}
