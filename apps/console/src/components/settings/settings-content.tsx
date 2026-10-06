import { and, eq } from "drizzle-orm"

import { SettingsForm } from "@/components/settings/settings-form"
import { db } from "@/db/client"
import { account, user as userTable } from "@/db/schema"
import { getFullSessionUser } from "@/lib/auth/session"

/**
 * Account settings: avatar, name, email, phone number, password.
 *
 * One component behind two pages, `/console/settings` and
 * `/dashboard/settings`, because the settings an account has are the same
 * whichever console it is sitting in: what differs is the frame around them and
 * the sidebar's own row that points here. Two copies of this file would be two
 * places for the next field to be added to one of them.
 *
 * The one question this page cannot answer from the session is whether the
 * account has a password at all — a phone-only account has none, and
 * `changePassword` needs a current one to compare against while an account that
 * never set one has to go through better-auth's `setPassword` instead. That is a
 * server-side question about the `account` table, so it is answered here and
 * passed down as a flag rather than guessed at in the browser.
 */
export async function SettingsContent() {
  const session = await getFullSessionUser()

  if (!session) {
    // The console layout gate has already redirected; this is the type narrowing,
    // and the alternative — an `if (!user) return null` — renders an empty page
    // for a frame if the two ever disagree.
    return null
  }

  const [credential] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, session.id), eq(account.providerId, "credential"))
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
