import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi"

const MessageSchema = z
  .object({
    message: z.string().openapi({ example: "Hello from API" }),
  })
  .openapi("Message")

const helloRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Hello"],
  summary: "Say hello",
  responses: {
    200: {
      content: { "application/json": { schema: MessageSchema } },
      description: "Returns a greeting message",
    },
  },
})

const app = new OpenAPIHono().openapi(helloRoute, (c) => {
  return c.json({ message: "Hello from API" })
})

export default app
export type AppType = typeof app
