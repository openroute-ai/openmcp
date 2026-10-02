"use client"

import { useSyncExternalStore } from "react"
import { IconDownload, IconX } from "@tabler/icons-react"

const ANNOUNCE_KEY = "vcx-announce-hidden-at"
const ANNOUNCE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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
    const v = localStorage.getItem(ANNOUNCE_KEY)
    return !!v && Date.now() - Number(v) <= ANNOUNCE_TTL_MS
  } catch {
    return false
  }
}

const getAnnounceHiddenOnServer = () => true

// A writable store rather than a bare getSnapshot: dismissing the bar has to
// tell React, and the no-op `subscribe` of a read-only store could not. The
// cache is what keeps `getSnapshot` referentially stable, which
// `useSyncExternalStore` requires to avoid an infinite render loop.
let announceCache: boolean | undefined
const announceListeners = new Set<() => void>()

function getAnnounceHidden() {
  return (announceCache ??= readAnnounceHidden())
}

function setAnnounceHidden(next: boolean) {
  announceCache = next
  for (const listener of announceListeners) listener()
}

function subscribeToAnnounce(listener: () => void) {
  announceListeners.add(listener)
  return () => {
    announceListeners.delete(listener)
  }
}

/**
 * The one-off announcement above the landing page's nav.
 *
 * Home only, and that is where the decision lives: the landing page renders
 * this, `SiteNav` does not, and nothing else on the site does. The bar
 * advertises the report the landing page's own hero offers, so a reader who
 * arrived from the rankings was never offered the thing being announced — the
 * same argument as the hero section it sits above, which is likewise not part of
 * the nav the other pages share.
 */
export function AnnounceBar() {
  const hidden = useSyncExternalStore(
    subscribeToAnnounce,
    getAnnounceHidden,
    getAnnounceHiddenOnServer
  )

  if (hidden) return null

  const dismiss = () => {
    setAnnounceHidden(true)
    try {
      localStorage.setItem(ANNOUNCE_KEY, String(Date.now()))
    } catch {
      // ignore
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-2.5">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md">
        <p className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full bg-secondary/70 px-1.5 py-0.5 text-[10px] leading-4 font-semibold text-secondary-foreground">
            NEW
          </span>
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
  )
}
