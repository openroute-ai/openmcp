import { createAuthClient } from "better-auth/react"
import { inferAdditionalFields } from "better-auth/client/plugins"
import { phoneNumberClient } from "better-auth/client/plugins"
import type { auth } from "./auth"

export const authClient = createAuthClient({
  // Mirrors the server's `user.additionalFields`, so `role` is a known property
  // of the session user on the client too. Without it a form could not choose a
  // landing path by role, and every check would be a cast.
  // https://www.better-auth.com/docs/concepts/typescript#additional-fields
  plugins: [inferAdditionalFields<typeof auth>(), phoneNumberClient()],
})