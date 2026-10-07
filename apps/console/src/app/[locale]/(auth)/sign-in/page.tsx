import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { GITHUB_CONFIGURED } from "@/lib/auth"
import { safeCallbackPath } from "@/lib/auth/callback"
import { requireUnauth } from "@/lib/auth/session"
import { SignInForm } from "./sign-in-form"

// The page resolves the session to keep a signed-in visitor off the form.
export const dynamic = "force-dynamic"

// The tab title is translated, so it cannot be a static export.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth")
  return { title: t("signInTitle") }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  // Cookie presence is not a session, so the proxy no longer redirects here.
  // This is the server-side half of the same decision, and it sends a
  // genuinely signed-in account to the console its role belongs to.
  await requireUnauth()

  const params = await searchParams
  // `?callbackURL=/?plan=pro` is how the checkout dialog sends a visitor here and
  // gets them back to the price they clicked. Validated once, server side, before
  // it can reach a single `router.push`.
  const callbackURL = safeCallbackPath(params?.callbackURL)

  return <SignInForm githubEnabled={GITHUB_CONFIGURED} callbackURL={callbackURL} />
}
