import type { BetterAuthOptions } from "better-auth"
import { openAPI } from "better-auth/plugins"

export const sharedAuthOptions = {
  emailAndPassword: {
    enabled: true,
  },
  plugins: [openAPI()],
} satisfies Partial<BetterAuthOptions>
