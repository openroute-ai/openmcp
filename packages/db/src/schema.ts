import * as authSchema from "./auth-schema"
import * as blogSchema from "./blog-schema"
import * as mcpSchema from "./mcp-schema"
import * as registrySchema from "./registry-schema"
import * as workflowSchema from "./workflow-schema"

export * from "./auth-schema"
export * from "./blog-schema"
export * from "./mcp-schema"
export * from "./registry-schema"
export * from "./workflow-schema"

export const schema = {
  ...authSchema,
  ...blogSchema,
  ...mcpSchema,
  ...registrySchema,
  ...workflowSchema,
}
