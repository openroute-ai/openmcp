/**
 * Tests for the proxy's matcher.
 *
 * The matcher is the one line that decides what the auth gate and the i18n
 * middleware ever see, and its failure mode is silent: too wide and a static
 * file is rewritten to a locale-prefixed path that has no file behind it, so
 * `/images/contact-wechat.webp` answered the image optimizer with an HTML 404
 * and every `next/image` QR dialog fell back to its placeholder — a 404 nobody
 * clicked, only a broken image. Too narrow and a page is answered by a gate
 * that never runs it.
 *
 * So the paths that must reach Next untouched are written out here, next to
 * the paths that must not, and the regex is exercised with both.
 */
import { describe, expect, it } from "vitest"

import { config } from "@/proxy"
import { Routes } from "@/lib/routes"

/**
 * Next compiles each matcher string into a `RegExp` and tests it against the
 * pathname. The `^` is not decoration: the matcher is a *path* pattern, which
 * Next anchors at the start, so a pattern that is not anchored here would also
 * match at the second slash of `/api/trpc` (`/trpc`) and report a route as
 * gated that the gate never sees.
 */
const matcher = new RegExp(`^${config.matcher[0]}`)

/** True when the proxy would run for this path. */
const gated = (path: string): boolean => matcher.test(path)

/**
 * The routes that are not pages: the file-based metadata routes and the text
 * files the site ships to machines. None of them lives under `[locale]`, so
 * the intl middleware has no locale spelling to rewrite them to.
 */
const MACHINE_ROUTES = [
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/llms.txt",
  "/llms-full.txt",
]

/** The same for `public/`: images, icons, logos, the QR code, docs assets. */
const STATIC_FILES = [
  "/images/contact-wechat.webp",
  "/images/blog/post-1.png",
  "/logo.svg",
  "/logo.png",
  "/favicon.svg",
  "/banner.png",
  "/assets/logos/voyage.webp",
  "/install/openmcp.md",
  "/_images/embed/white-label/logo-main-sidebar.png",
]

describe("the proxy matcher", () => {
  it("lets the file-based metadata routes through untouched", () => {
    for (const path of MACHINE_ROUTES) {
      expect(gated(path), path).toBe(false)
    }
  })

  it("lets the static files in public/ through untouched", () => {
    for (const path of STATIC_FILES) {
      expect(gated(path), path).toBe(false)
    }
  })

  it("leaves the API routes to their own guards", () => {
    expect(gated("/api/trpc")).toBe(false)
    expect(gated("/api/auth/sign-in")).toBe(false)
    expect(gated("/trpc/session.get")).toBe(false)
  })

  it("still runs for every page, public or not", () => {
    // `Routes.Chat` is an absolute URL, not a pathname; a browser never sends
    // one to the proxy.
    for (const path of Object.values(Routes).filter((route) => route.startsWith("/"))) {
      expect(gated(path), path).toBe(true)
    }
  })

  it("still runs for the locale-prefixed spelling of a page", () => {
    for (const path of [
      "/en",
      "/en/dashboard",
      "/en/dashboard/apikeys",
      "/en/admin/users",
      "/zh/contact",
    ]) {
      expect(gated(path), path).toBe(true)
    }
  })

  it("runs for a deeply nested child, which is where a gate has to be careful", () => {
    // Section roots and their children alike carry no extension, so the
    // matcher cannot accidentally skip the pages the auth gate exists for.
    expect(gated("/dashboard")).toBe(true)
    expect(gated("/dashboard/installs")).toBe(true)
    expect(gated("/admin/mcp-servers/42")).toBe(true)
    expect(gated("/dashboard/earnings/[id]")).toBe(true)
  })

  it("does not treat a page whose segment merely contains a dot as a file", () => {
    // `.*\.[^./]+$` needs the dot in the *last* segment, so a dotted name
    // anywhere else still reaches the proxy.
    expect(gated("/docs/v1.2/mcp")).toBe(true)
    expect(gated("/en/docs/v1.2")).toBe(true)
  })
})
