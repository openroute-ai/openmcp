import { phoneNumberClient } from "better-auth/client/plugins"
import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { auth } from "./auth"

export const authClient = createAuthClient({
  // Mirrors the server `user.additionalFields` so custom columns such as `role`
  // are typed on the session user.
  // https://www.better-auth.com/docs/concepts/typescript#additional-fields
  plugins: [inferAdditionalFields<typeof auth>(), phoneNumberClient()],
})

// Actions are consumed through `authClient` rather than re-exported as
// standalone bindings: the inferred action types reference internal better-auth
// type paths, which cannot be named for declaration emit.
export type AuthClient = typeof authClient
