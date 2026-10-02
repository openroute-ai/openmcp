import { SiteNav } from "@/components/nav/site-nav"
import { getSessionUser } from "@/lib/auth/session"
import { landingPathFor } from "@/lib/auth/role"
import { SITE_NAME } from "@/lib/config/site"

/**
 * The chrome around the public radar pages: anomalies, the two rankings,
 * categories, detail, and the long-form pages that hang off the footer
 * (method, guide, docs, about, contact, blog and the four legal routes).
 *
 * The nav is the same component the landing page renders, and the banner above
 * it is not: the announce bar is a campaign for the landing page's own copy, so
 * a reader who arrived from the rankings is never shown an ad for a download they
 * were not offered. Everything else — the mark, the five links, the account
 * action, the mobile menu — is shared, so following one of these links lands on a
 * page whose nav looks exactly like the one they clicked, and the two chrome
 * bars read as one site instead of two.
 *
 * The shell resolves the session itself rather than asking each page to pass the
 * account action in: a dozen pages would otherwise each import the auth module
 * and repeat the same two-line mapping, and the landing page already resolves it
 * the same way. `getSessionUser` returns null without a database round trip when
 * there is no cookie, which is the case for every crawler and every shared link.
 *
 * Reading a request header is what makes a page dynamic, so a route that wants to
 * be prerendered cannot use this shell — it would get the anonymous answer baked
 * in. `/faq` is the one that was prerendered and now is not.
 *
 * Chinese only, like the rest of the public surface. These pages are reached by
 * shared links and by agents fetching a URL, not by a reader choosing a locale,
 * and the landing has no translated copy either — adding a `next-intl` namespace
 * to one of two Chinese surfaces would make the split worse, not better.
 */

function PublicFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
        <span>{SITE_NAME}</span>
        <span>数据每周更新</span>
      </div>
    </footer>
  )
}

export async function PublicShell({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav cta={{ href: landingPathFor(user), signedIn: user !== null }} />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  )
}

/** The page heading every public page starts with. */
export function PublicPageHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div className="grid gap-3 border-b border-border pb-6">
      <div className="grid gap-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {title}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
