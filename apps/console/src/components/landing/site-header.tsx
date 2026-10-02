"use client"

import { useState, useSyncExternalStore } from "react";
import { IconChevronDown, IconDownload, IconMenu, IconX } from "@tabler/icons-react";

import { SiteMark } from "@/components/brand/site-mark";
import { LocaleLink } from "@/i18n/navigation";
import { SITE_HOST, SITE_NAME } from "@/lib/config/site";
import type { RoutePath } from "@/lib/routes";

import { ThemeToggle } from "./theme";

const ANNOUNCE_KEY = "vcx-announce-hidden-at";
const ANNOUNCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the announce bar is currently hidden, as a store over localStorage.
 *
 * `localStorage` has no meaning on the server, so the server snapshot is the
 * constant `true`: the bar is absent from the server HTML, and because the
 * client's hydration render also sees `true`, the two agree. React then reads
 * the real value immediately after hydration and reveals the bar if it should be
 * shown. Reading it in a `useState` initialiser instead branches on the
 * environment during render — server `true`, client `false` — which is the same
 * hydration mismatch `use-reveal.tsx` was rewritten to avoid, in another
 * component.
 *
 * Returns `false` (i.e. show the bar) when storage is unavailable, so a
 * private-mode browser sees the bar every visit rather than never.
 */
function readAnnounceHidden() {
  try {
    const v = localStorage.getItem(ANNOUNCE_KEY);
    return !!v && Date.now() - Number(v) <= ANNOUNCE_TTL_MS;
  } catch {
    return false;
  }
}

const getAnnounceHiddenOnServer = () => true;

// A writable store rather than a bare getSnapshot: dismissing the bar has to
// tell React, and the no-op `subscribe` of a read-only store could not. The
// cache is what keeps `getSnapshot` referentially stable, which
// `useSyncExternalStore` requires to avoid an infinite render loop.
let announceCache: boolean | undefined;
const announceListeners = new Set<() => void>();

function getAnnounceHidden() {
  return (announceCache ??= readAnnounceHidden());
}

function setAnnounceHidden(next: boolean) {
  announceCache = next;
  for (const listener of announceListeners) listener();
}

function subscribeToAnnounce(listener: () => void) {
  announceListeners.add(listener);
  return () => {
    announceListeners.delete(listener);
  };
}

/**
 * The destinations a visitor actually has: the anomaly feed, the two rankings and
 * the category index. They are routes rather than `#anchors` because all four are
 * real pages that stand on their own — they are public and readable without an
 * account, and are linked from shared articles and by agents. Anchoring the
 * header into this page's own sections would have left the header dead
 * everywhere else.
 *
 * The four are the public pages' own `PublicShell` nav, and that is deliberate:
 * someone who follows one of these links lands on a page whose header offers the
 * same list, so the two chrome bars read as one site instead of two. `FAQ` used to
 * sit here and does not any more — it is a landing-page section (`#faq`) that also
 * has a standalone route, and the route is where the header already sends people.
 */
const NAV_LINKS = [
  { label: "异动", href: "/anomalies" },
  { label: "公开榜单", href: "/rankings" },
  { label: "飙升榜", href: "/rankings/rising" },
  { label: "分类", href: "/categories" },
] as const;

function AnnounceBar() {
  const hidden = useSyncExternalStore(
    subscribeToAnnounce,
    getAnnounceHidden,
    getAnnounceHiddenOnServer,
  );

  if (hidden) return null;

  const dismiss = () => {
    setAnnounceHidden(true);
    try {
      localStorage.setItem(ANNOUNCE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pt-2.5">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md">
        <p className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full bg-secondary/70 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-secondary-foreground">NEW</span>
          <span className="truncate">
            2026 AI Agent 框架选型报告已发布 — 对比 12 个项目，免费下载
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href="#download"
            className="hidden items-center gap-1 font-medium text-secondary-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            立即下载
            <IconDownload size={13} />
          </a>
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭公告"
            className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <IconX size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <a href="#top" className="flex shrink-0 items-center gap-2.5">
      <SiteMark className="size-8 shrink-0" />
      <span className="font-display text-base font-semibold tracking-tight">{SITE_NAME}</span>
      <span className="hidden text-xs text-muted-foreground sm:block">{SITE_HOST}</span>
    </a>
  );
}

interface SiteHeaderProps {
  /**
   * The account action in the header, already resolved on the server.
   *
   * It is a prop rather than something this component derives because the
   * landing page serves signed-in and anonymous visitors alike, and the header
   * is a client component that cannot read a session. The two answers differ in
   * destination *and* label, so both arrive together: an anonymous visitor gets
   * "登录" pointing at `/sign-in`, a signed-in one gets "进入控制台" pointing at
   * their console. An expired cookie resolves to no user and therefore to the
   * ordinary sign-in case, which is correct — there is nobody to enter as.
   */
  cta: { href: RoutePath; signedIn: boolean };
}

export function SiteHeader({ cta }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ctaLabel = cta.signedIn ? "进入控制台" : "登录";

  return (
    <>
      <AnnounceBar />
      {/**
       * Sticky rather than absolute, and frosted at every scroll position
       * instead of only once the page has moved: the bar is the one piece of
       * chrome that has to stay legible while the hero scrolls under it, and a
       * header that only turns opaque after 12px spends that first screen at
       * its least readable. `bg-background/70` over `backdrop-blur-xl` is the
       * glass — the alpha is what lets the content behind show through blurred
       * rather than simply being covered.
       */}
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo />

          <nav className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
            {NAV_LINKS.map((link) => (
              <LocaleLink key={link.href} href={link.href} className="transition-colors hover:text-foreground">
                {link.label}
              </LocaleLink>
            ))}
          </nav>

          <div className="hidden items-center gap-2.5 lg:flex">
            <ThemeToggle />
            <LocaleLink
              href={cta.href}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              {ctaLabel}
            </LocaleLink>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <ThemeToggle />
            <button
              type="button"
              aria-label="打开菜单"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid size-9 place-items-center rounded-lg border border-border bg-card text-foreground"
            >
              {menuOpen ? <IconX size={18} /> : <IconMenu size={18} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-border bg-background/80 backdrop-blur-xl lg:hidden">
            <nav className="mx-auto grid max-w-6xl gap-1 px-4 py-4 text-sm">
              {NAV_LINKS.map((link) => (
                <LocaleLink
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                >
                  {link.label}
                  <IconChevronDown size={14} className="-rotate-90 opacity-50" />
                </LocaleLink>
              ))}
              <LocaleLink
                href={cta.href}
                onClick={() => setMenuOpen(false)}
                className="mt-2 rounded-lg border border-border px-4 py-2.5 text-center font-medium text-foreground transition-colors hover:bg-card"
              >
                {ctaLabel}
              </LocaleLink>
            </nav>
          </div>
        )}
      </header>
    </>
  );
}
