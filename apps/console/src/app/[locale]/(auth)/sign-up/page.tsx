import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { GITHUB_CONFIGURED } from "@/lib/auth"
import { SignUpForm } from "./sign-up-form"

// The tab title is translated, so it cannot be a static export.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth")
  return { title: t("signUpTitle") }
}

export default function SignUpPage() {
  return <SignUpForm githubEnabled={GITHUB_CONFIGURED} />
}
