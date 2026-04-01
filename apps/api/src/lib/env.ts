import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

const commaSeparatedList = z
  .string()
  .optional()
  .transform((val) =>
    val
      ? val
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []
  )

export const env = createEnv({
  server: {
    PORT: z
      .string()
      .optional()
      .default("8080")
      .transform(Number)
      .pipe(z.number().int().positive()),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.url().optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: commaSeparatedList,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
})
