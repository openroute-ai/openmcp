import { getTranslations } from "next-intl/server"
import { IconArrowLeft } from "@tabler/icons-react"

import { LocaleLink } from "@/i18n/navigation"
import { getSessionUser, redirectTo } from "@/lib/auth/session"
import { landingPathFor } from "@/lib/auth/role"
import { Routes } from "@/lib/routes"

export const dynamic = "force-dynamic"

/**
 * The gate on the settings pages.
 *
 * Not one of the two console layouts, because settings apply to every account:
 * an admin is redirected away from `/console` by that layout's gate, so a
 * settings page living under it would be unreachable for exactly the people who
 * administer it. One page with its own gate serves both, and the sidebar entry
 * points at it from whichever console the reader's role lands them in.
 *
 * As on the two console gates this is UX, not authorization: every write it
 * fronts re-checks the session server-side.
 */
export default async function SettingsGate({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()

  if (!user) {
    await redirectTo(Routes.signIn)
  }

  const t = await getTranslations("Settings")

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <LocaleLink
        href={landingPathFor(user)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        {t("backToConsole")}
      </LocaleLink>
      {children}
    </main>
  )
}
