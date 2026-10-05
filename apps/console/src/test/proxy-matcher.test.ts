/**
 * Tests for the proxy's matcher.
 *
 * The matcher is the one line that decides what the auth gate ever gets to see,
 * and both of its failure modes are silent. Too wide and every signed-in page
 * answers a crawler with a login form — no status code says "wrong", the 307 is
 * a perfectly good redirect. Too narrow and a route that is not a page is
 * answered with a login page where a text file, a sitemap or an image was
 * promised; `/llms.txt` returning HTML is not a 404 that anyone reports, it is
 * an answer engine that concludes the site has nothing for it.
 *
 * So the list of paths that must reach Next untouched is written out here, next
 * to the list of paths that must not, and the regex is exercised with both.
 */
import { describe, expect, it } from "vitest"

import { config } from "@/proxy"
import { PublicRoutes, Routes } from "@/lib/routes"

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
 * none of them can be listed in `PublicRoutes` — the gate's list is a set of
 * page paths, and a page path has no extension.
 */
const MACHINE_ROUTES = [
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/favicon.ico",
]

/** The same for `public/`: the OG image, the manifest icons, the QR code. */
const STATIC_FILES = [
  "/og.png",
  "/logo.svg",
  "/logo-192.png",
  "/apple-touch-icon.png",
  "/images/contact-wechat.webp",
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
    expect(gated("/api/v1/rankings/weekly")).toBe(false)
    expect(gated("/openapi.json")).toBe(false)
    expect(gated("/api/trpc")).toBe(false)
  })

  it("still runs for every page, public or not", () => {
    for (const path of [
      ...Object.values(Routes),
      ...Object.values(PublicRoutes),
    ]) {
      expect(gated(path), path).toBe(true)
    }
  })

  it("still runs for the locale-prefixed spelling of a page", () => {
    for (const path of [
      "/en",
      "/en/dashboard",
      "/en/console/decisions",
      "/en/rankings",
    ]) {
      expect(gated(path), path).toBe(true)
    }
  })

  it("runs for a child's path, which is where a gate has to be careful", () => {
    // The reason `isPublicPath` prefix-matches: `/rankings` is a section root and
    // `/console` is the only `/console*` page, so both children of the first must
    // reach the proxy while the second keeps being gated.
    expect(gated("/rankings/week")).toBe(true)
    expect(gated("/console/repos/42")).toBe(true)
  })
})
