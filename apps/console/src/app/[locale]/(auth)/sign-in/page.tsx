import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { GITHUB_CONFIGURED } from "@/lib/auth"
import { SignInForm } from "./sign-in-form"

// The tab title is translated, so it cannot be a static export.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth")
  return { title: t("signInTitle") }
}

export default function SignInPage() {
  return <SignInForm githubEnabled={GITHUB_CONFIGURED} />
}
