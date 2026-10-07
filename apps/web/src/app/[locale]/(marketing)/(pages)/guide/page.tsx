import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { ArrowRight, BookOpenIcon, Clock, Terminal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { GuideToc } from "@/components/guide/guide-toc"
import { assertLocale, isLocale } from "@/i18n/routing"
import { LocaleLink } from "@/i18n/navigation"
import { constructMetadata } from "@/lib/metadata"
import { Routes } from "@/lib/routes"
import { getUrlWithLocale } from "@/lib/urls/urls"
import { getCompiledPage } from "@/lib/utils/get-compiled-page"

type PageProps = {
  params: Promise<{ locale: string }>
}

const PAGE_TYPE = "user-guide"

/** Jump target for the hero CTA; keeps the anchor out of the translation files. */
const CONTENT_ANCHOR = "#guide-content"

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata | undefined> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }

  const page = await getCompiledPage(PAGE_TYPE, locale)
  if (!page) {
    return {}
  }

  const t = await getTranslations({ locale, namespace: "Metadata" })

  return constructMetadata({
    title: `${page.title} | ${t("title")}`,
    description: page.description,
    canonicalUrl: getUrlWithLocale("/guide", locale),
  })
}

/**
 * Publish-a-Skill walkthrough, rendered from `content/pages/user-guide.mdx`.
 *
 * This is a public landing page: it lives in the `(marketing)` group so the
 * navbar, footer and sitemap apply, and `/guide` is deliberately absent from
 * `userConsoleRoutes` so a signed-out visitor is never redirected to sign-in.
 *
 * The body is real MDX compiled per request, because the guide uses
 * `<Steps>`/`<Callout>`/`<Accordions>`, which `react-markdown` cannot render.
 */
export default async function UserGuidePage({ params }: PageProps) {
  const locale = assertLocale((await params).locale)
  const page = await getCompiledPage(PAGE_TYPE, locale)

  if (!page) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: "GuidePage" })
  const Mdx = page.body

  return (
    <>
      <section className="relative border-b border-border bg-gradient-to-b from-muted/40 to-background pt-14 pb-12 md:pt-20 md:pb-16">
        <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-3xl text-center">
            <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <BookOpenIcon className="size-3.5" />
              {t("eyebrow")}
            </span>

            <h1 className="text-display font-medium tracking-tight text-balance text-foreground">
              {page.title}
            </h1>

            <p className="mt-5 text-lead leading-relaxed text-pretty text-muted-foreground">
              {page.description}
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="rounded-full" asChild>
                <a href={CONTENT_ANCHOR}>
                  {t("ctaStart")}
                  <ArrowRight className="ml-2 size-4" />
                </a>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="rounded-full"
                asChild
              >
                <LocaleLink href={Routes.Skills}>
                  <Terminal className="mr-2 size-4" />
                  {t("ctaBrowse")}
                </LocaleLink>
              </Button>
            </div>

            <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-small text-muted-foreground">
              {(["time", "audience", "level"] as const).map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-1 rounded-full bg-border" />
                  {t(`facts.${item}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div
        id={CONTENT_ANCHOR.slice(1)}
        className="mx-auto w-full max-w-page scroll-mt-24 px-5 py-18 sm:px-6 lg:px-10"
      >
        <div className="flex flex-col gap-x-10 gap-y-10 lg:flex-row">
          <article className="min-w-0 flex-1">
            <div className="prose prose-headings:scroll-mt-24 prose-headings:font-medium prose-headings:tracking-tight">
              <Mdx />
            </div>
          </article>

          <GuideToc toc={page.toc} label={t("toc")} />
        </div>
      </div>

      <section className="pb-18">
        <div className="mx-auto w-full max-w-page px-5 sm:px-6 lg:px-10">
          <div className="relative overflow-hidden rounded-[24px] bg-foreground px-8 py-14 text-center text-background md:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                backgroundImage:
                  "radial-gradient(circle, currentColor 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />

            <div className="relative">
              <Clock aria-hidden className="mx-auto mb-5 size-6" />
              <h2 className="mx-auto mb-4 max-w-2xl text-title font-medium tracking-tight text-balance text-background">
                {t("footerCta.title")}
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-lead leading-relaxed text-pretty text-background/80">
                {t("footerCta.description")}
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="rounded-full bg-background text-foreground hover:bg-muted"
                  asChild
                >
                  <LocaleLink href={Routes.Skills}>
                    {t("footerCta.primary")}
                  </LocaleLink>
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="rounded-full bg-white/10 text-background hover:bg-white/20 hover:text-background"
                  asChild
                >
                  <LocaleLink href={Routes.Login}>
                    {t("footerCta.secondary")}
                  </LocaleLink>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
