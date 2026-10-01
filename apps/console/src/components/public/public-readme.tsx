"use client"

import {
  ReadmeViewer,
  type Language,
} from "@/components/projects/readme-viewer"

/**
 * README of a public project.
 *
 * A thin wrapper around the existing ReadmeViewer so the public page can reuse
 * its sanitization, tabs, and styling instead of duplicating them. It remains a
 * client component because ReadmeViewer is interactive (tabs, collapse).
 */
export function PublicReadme({
  readme,
  readmeZh,
  locale,
}: {
  readme: string | null
  readmeZh: string | null
  locale: string
}) {
  const initialLocale: Language = locale === "en" ? "en" : "zh"

  return (
    <ReadmeViewer
      readmeContent={readme}
      readmeContentZh={readmeZh}
      initialLocale={initialLocale}
      defaultOpen
      fallback={
        <p className="text-sm text-muted-foreground">
          该项目还没有公开的 README。
        </p>
      }
    />
  )
}
