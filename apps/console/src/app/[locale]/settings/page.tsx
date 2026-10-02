import { and, eq } from "drizzle-orm"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"

import { SettingsForm } from "@/components/settings/settings-form"
import { db } from "@/db/client"
import { account, user as userTable } from "@/db/schema"
import { getFullSessionUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings")
  return { title: t("title") }
}

/**
 * Account settings: avatar, name, email, phone number, password.
 *
 * The one question this page cannot answer from the session is whether the
 * account has a password at all — a phone-only account has none, and
 * `changePassword` needs a current one to compare against while an account that
 * never set one has to go through better-auth's `setPassword` instead. That is a
 * server-side question about the `account` table, so it is answered here and
 * passed down as a flag rather than guessed at in the browser.
 */
export default async function SettingsPage() {
  const session = await getFullSessionUser()

  if (!session) {
    // The layout gate already redirects; this is the type narrowing, and the
    // alternative — an `if (!user) return null` — renders an empty page for a
    // frame if the two ever disagree.
    return null
  }

  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, session.id),
        eq(account.providerId, "credential")
      )
    )
    .limit(1)

  const [record] = await db
    .select({
      name: userTable.name,
      email: userTable.email,
      emailVerified: userTable.emailVerified,
      image: userTable.image,
      phoneNumber: userTable.phoneNumber,
      phoneNumberVerified: userTable.phoneNumberVerified,
    })
    .from(userTable)
    .where(eq(userTable.id, session.id))
    .limit(1)

  return (
    <SettingsForm
      user={{
        id: session.id,
        name: record?.name ?? session.name ?? "",
        email: record?.email ?? session.email ?? "",
        emailVerified: record?.emailVerified ?? false,
        image: record?.image ?? null,
        phoneNumber: record?.phoneNumber ?? null,
        phoneNumberVerified: record?.phoneNumberVerified ?? false,
      }}
      hasPassword={Boolean(credential)}
    />
  )
}
