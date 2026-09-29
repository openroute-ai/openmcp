import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SignInForm } from "./sign-in-form"

export const metadata: Metadata = {
  title: "Sign In",
}

export default function SignInPage() {
  // SignInForm reads `callbackUrl` with useSearchParams, which opts the route
  // out of static rendering unless it is wrapped in a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}
