"use client"

/**
 * Renders a stored README, in whichever language it has.
 *
 * The Markdown arrives from `processReadMeMd`, which rewrites relative links to
 * absolute ones and mirrors images to the bucket. That rewrite deliberately
 * leaves the original HTML tags in place — `<a href>` and `<img src>` are
 * rewritten, not converted — and raw HTML is how most READMEs carry their
 * badges, so the renderer has to read it. `rehype-raw` does that, and it is
 * only safe because `rehype-sanitize` runs straight after it: the content is a
 * third party's file, rendered inside an authenticated console, and the source
 * app rendered it with no sanitizer at all.
 */

import { useMemo, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react"

/**
 * Tags a README may use beyond GitHub's own defaults.
 *
 * The sanitizer's schema is an allowlist, so anything not named here is
 * stripped: `<div>` and `<span>` for layout inside table cells, `<details>` for
 * the collapsible sections READMEs use for changelogs, and `<sub>`/`<sup>`.
 * `className` stays out of `attributes` on purpose — GitHub's own attribute
 * names carry styling that has nothing to do with this design system.
 */
const schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "div",
    "span",
    "details",
    "summary",
    "sub",
    "sup",
    "kbd",
    "picture",
    "source",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "align"],
    a: [...(defaultSchema.attributes?.a ?? []), "target"],
    td: [
      ...(defaultSchema.attributes?.td ?? []),
      "align",
      "colspan",
      "rowspan",
    ],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      "align",
      "colspan",
      "rowspan",
    ],
  },
}

export type Language = "zh" | "en"

export interface ReadmeViewerProps {
  readmeContent: string | null
  readmeContentZh: string | null
  /** Rendered above the tabs when neither README is stored yet. */
  fallback?: React.ReactNode
  /** Whether the document starts expanded. */
  defaultOpen?: boolean
  /** Which language to open the viewer in. */
  initialLocale?: Language
}

export function ReadmeViewer({
  readmeContent,
  readmeContentZh,
  fallback,
  defaultOpen = true,
  initialLocale = "zh",
}: ReadmeViewerProps) {
  const t = useTranslations("ProjectDetail")

  // Chinese is the default tab only when there is one. Offering a "中文" tab
  // that holds the English text, because translation silently failed, is worse
  // than not offering it.
  const [language, setLanguage] = useState<Language>(
    readmeContentZh
      ? readmeContent?.trim()
        ? (initialLocale ?? "zh")
        : "zh"
      : readmeContent
        ? initialLocale === "zh" && readmeContentZh
          ? "zh"
          : "en"
        : "en"
  )

  const source = language === "zh" ? readmeContentZh : readmeContent
  const hasReadme = Boolean(readmeContent || readmeContentZh)

  return (
    <Card>
      <Collapsible defaultOpen={defaultOpen && hasReadme}>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>{t("readme")}</CardTitle>
              <CardDescription className="sr-only">
                {t("readmeDescription")}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {hasReadme ? (
                <Tabs
                  value={language}
                  onValueChange={(value) => setLanguage(value as Language)}
                >
                  <TabsList>
                    <TabsTrigger value="zh" disabled={!readmeContentZh}>
                      {t("readmeChinese")}
                    </TabsTrigger>
                    <TabsTrigger value="en" disabled={!readmeContent}>
                      {t("readmeEnglish")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : null}
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {t("readmeToggle")}
                  <IconChevronUp className="group-data-[state=closed]:hidden" />
                  <IconChevronDown className="hidden group-data-[state=closed]:block" />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {hasReadme && source ? (
              <ReadmeBody source={source} />
            ) : (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("readmeMissing")}
                </p>
                {fallback}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/**
 * The document itself.
 *
 * `useMemo` over the source because the pipeline is not cheap and this
 * re-renders on every parent state change — including the resync button's.
 */
function ReadmeBody({ source }: { source: string }) {
  const components = useMemo(
    () => ({
      a: ({ children, href, ...props }: React.ComponentProps<"a">) => (
        <a
          {...props}
          href={href}
          // READMEs are full of links meant to leave the site, and a README
          // that can navigate the console away from itself is a phishing
          // surface in an authenticated page.
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          {children}
        </a>
      ),
      img: ({ alt, ...props }: React.ComponentProps<"img">) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...props}
          alt={alt ?? ""}
          loading="lazy"
          className="inline-block max-w-full rounded-md"
        />
      ),
      // A fenced block with a language renders as inline-ish text otherwise,
      // and the vertical scroll is what makes a long README readable.
      pre: ({ children, ...props }: React.ComponentProps<"pre">) => (
        <pre
          {...props}
          className="overflow-x-auto rounded-lg bg-muted p-4 text-sm"
        >
          {children}
        </pre>
      ),
      code: ({
        className,
        children,
        ...props
      }: React.ComponentProps<"code">) =>
        className ? (
          <code {...props} className={className}>
            {children}
          </code>
        ) : (
          <code
            {...props}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
          >
            {children}
          </code>
        ),
      table: ({ children, ...props }: React.ComponentProps<"table">) => (
        <div className="my-4 overflow-x-auto">
          <table {...props} className="w-full border-collapse text-sm">
            {children}
          </table>
        </div>
      ),
      th: ({ children, ...props }: React.ComponentProps<"th">) => (
        <th
          {...props}
          className="border border-border px-3 py-2 text-left font-medium"
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }: React.ComponentProps<"td">) => (
        <td {...props} className="border border-border px-3 py-2 align-top">
          {children}
        </td>
      ),
    }),
    []
  )

  return (
    <article className="readme max-w-none text-sm leading-relaxed">
      <Markdown
        remarkPlugins={[remarkGfm]}
        // `rehype-raw` first, so the README's own HTML becomes nodes, then the
        // sanitizer, so nothing that arrived as markup survives unfiltered.
        // Reversed, the sanitizer would strip the raw nodes before raw ever
        // parsed them and the badges would disappear.
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={components}
      >
        {source}
      </Markdown>
    </article>
  )
}

/**
 * The project's own description, in both languages.
 *
 * Separate from the README because it is the one line of prose that comes from
 * the project row rather than the repository, and it is what the list shows.
 */
export function DescriptionPair({
  description,
  descriptionZh,
}: {
  description: string
  descriptionZh: string | null
}) {
  if (!descriptionZh || descriptionZh === description) {
    return <p className="text-sm whitespace-pre-line">{description}</p>
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm whitespace-pre-line">{description}</p>
      <p className="text-sm whitespace-pre-line text-muted-foreground">
        {descriptionZh}
      </p>
    </div>
  )
}

/** A small row of labels, for topics, languages and aliases. */
export function LabelRow({
  items,
  variant = "secondary",
}: {
  items: string[]
  variant?: "secondary" | "outline"
}) {
  const common = useTranslations("Common")
  if (items.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">{common("none")}</span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant={variant}>
          {item}
        </Badge>
      ))}
    </div>
  )
}
