import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"

const HealthSchema = z
  .object({
    status: z.string().openapi({ example: "ok" }),
  })
  .openapi("Health")

const healthRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Health"],
  summary: "Health check",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "Service is healthy",
    },
  },
})

const app = new OpenAPIHono().openapi(healthRoute, (c) => {
  return c.json({ status: "ok" })
})

export default app
