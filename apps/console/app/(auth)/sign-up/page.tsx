import type { Metadata } from "next"
import { GITHUB_CONFIGURED } from "@/lib/auth"
import { SignUpForm } from "./sign-up-form"

export const metadata: Metadata = {
  title: "Sign Up",
}

export default function SignUpPage() {
  return <SignUpForm githubEnabled={GITHUB_CONFIGURED} />
}