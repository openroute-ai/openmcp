"use client"

import { useEffect, useState, useSyncExternalStore } from "react";
import { IconChevronDown, IconDownload, IconMenu, IconX } from "@tabler/icons-react";
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

const NAV_LINKS = [
  { label: "产品", href: "#product" },
  { label: "解决方案", href: "#solutions" },
  { label: "定价", href: "#pricing" },
  { label: "资源", href: "#download" },
  { label: "评分方法", href: "#method" },
];

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
    <div className="mx-auto max-w-6xl px-4 pt-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-2.5 text-sm backdrop-blur-md">
        <p className="flex min-w-0 items-center gap-2.5 text-muted-foreground">
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">NEW</span>
          <span className="truncate">
            2026 AI Agent 框架选型报告已发布 — 对比 12 个项目，免费下载
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="#download"
            className="hidden items-center gap-1.5 font-medium text-secondary-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            立即下载
            <IconDownload size={14} />
          </a>
          <button
            type="button"
            onClick={dismiss}
            aria-label="关闭公告"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <IconX size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <a href="#top" className="flex shrink-0 items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
        V
      </span>
      <span className="font-display text-base font-semibold tracking-tight">OpenMCP 雷达</span>
      <span className="hidden text-xs text-muted-foreground sm:block">radar.openmcp.cn</span>
    </a>
  );
}

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <AnnounceBar />
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-border bg-background/80 shadow-lg shadow-black/5 backdrop-blur-xl dark:shadow-black/30"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
          <Logo />

          <nav className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2.5 lg:flex">
            <ThemeToggle />
            <a
              href="#"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            >
              登录
            </a>
            <a
              href="#pricing"
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90"
            >
              免费开始
            </a>
            <a
              href="#download"
              className="rounded-lg border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-card"
            >
              预约演示
            </a>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <ThemeToggle />
            <a
              href="#pricing"
              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground"
            >
              免费开始
            </a>
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
          <div className="border-t border-border bg-background/95 backdrop-blur-xl lg:hidden">
            <nav className="mx-auto grid max-w-6xl gap-1 px-4 py-4 text-sm">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                >
                  {link.label}
                  <IconChevronDown size={14} className="-rotate-90 opacity-50" />
                </a>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <a
                  href="#pricing"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg bg-primary px-4 py-2.5 text-center font-semibold text-primary-foreground"
                >
                  免费开始
                </a>
                <a
                  href="#download"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg border border-border bg-card px-4 py-2.5 text-center font-medium text-foreground"
                >
                  预约演示
                </a>
              </div>
            </nav>
          </div>
        )}
      </header>
    </>
  );
}
