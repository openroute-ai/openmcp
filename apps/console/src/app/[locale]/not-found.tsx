import { useTranslations } from "next-intl"

import { LocaleLink } from "@/i18n/navigation"

/**
 * What the reader sees when a page does not exist.
 *
 * The locale segment is a dynamic route, so an unknown path under it is only
 * found here — the proxy rewrites an unsupported locale away, but
 * `/zh/no-such-page` reaches this component. Without it, Next renders a bare
 * English document with no header and no way back, which is both untranslated
 * and a dead end.
 *
 * The link is a `LocaleLink` so a reader who lost `/zh/page` stays in Chinese;
 * a plain `next/link` would drop them on the default locale.
 */
export default function NotFound() {
  const t = useTranslations("Errors")

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("notFoundTitle")}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("notFoundBody")}
      </p>
      <LocaleLink
        href="/dashboard"
        className="mt-2 text-sm font-medium text-primary underline underline-offset-4"
      >
        {t("backToDashboard")}
      </LocaleLink>
    </main>
  )
}
