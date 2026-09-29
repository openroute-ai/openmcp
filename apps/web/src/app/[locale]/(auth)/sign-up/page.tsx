import type { Metadata } from "next"
import { Suspense } from "react"
import { SignUpForm } from "./sign-up-form"
import { requireUnauth } from "@/lib/server/auth-utils"
import { Routes } from "@/lib/routes"

export const metadata: Metadata = {
  title: "Sign Up",
}

export default async function SignUpPage() {
  // A visitor who already has a valid session has no business on this page.
  await requireUnauth(Routes.Dashboard)

  return (
    // The form reads `callbackUrl` with useSearchParams, which opts the route
    // out of static rendering unless it is wrapped in a Suspense boundary.
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  )
}
