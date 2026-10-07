import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { GITHUB_CONFIGURED } from "@/lib/auth"
import { safeCallbackPath } from "@/lib/auth/callback"
import { requireUnauth } from "@/lib/auth/session"
import { SignUpForm } from "./sign-up-form"

// The page resolves the session to keep a signed-in visitor off the form.
export const dynamic = "force-dynamic"

// The tab title is translated, so it cannot be a static export.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth")
  return { title: t("signUpTitle") }
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  // Same reasoning as `/sign-in`: a signed-in visitor is sent to their own
  // console rather than shown a form that would create a second account.
  await requireUnauth()

  const params = await searchParams
  // The sign-in form hands it over on the way here (登录 ↔ 注册互跳), so a
  // reader who came from the checkout dialog ends the sign-up there too.
  const callbackURL = safeCallbackPath(params?.callbackURL)

  return <SignUpForm githubEnabled={GITHUB_CONFIGURED} callbackURL={callbackURL} />
}
