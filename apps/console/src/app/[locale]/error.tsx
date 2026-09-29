"use client"

import * as React from "react"
import { useTranslations } from "next-intl"

import { Button } from "@workspace/ui/components/button"

/**
 * What the reader sees when a page throws.
 *
 * Next renders its own page here, in English and with no way to recover, which
 * is the least helpful thing that can happen to someone whose action failed.
 * The digest goes in the details because it is what a log search needs, and
 * hiding it would make a report impossible to act on.
 *
 * The error itself is not shown: a server error's message can name internal
 * identifiers, and this renders in the document.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("Errors")

  React.useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">500</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("errorTitle")}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("errorBody")}</p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground/70">
          {t("errorReference", { digest: error.digest })}
        </p>
      )}
      <Button onClick={reset} className="mt-2">
        {t("tryAgain")}
      </Button>
    </main>
  )
}
