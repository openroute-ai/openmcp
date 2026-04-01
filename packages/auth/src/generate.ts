import { betterAuth } from "better-auth"
import { sharedAuthOptions } from "./options"

export const auth = betterAuth({
  ...sharedAuthOptions,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:8080",
})
