/**
 * Which paths a crawler may index, and which it must not.
 *
 * Written by hand rather than generated from `PublicRoutes` because the two
 * questions are different. `PublicRoutes` is the proxy's gate — it lists what a
 * *visitor without a session* may read, and it includes routes that must not be
 * indexed anyway. `robots.txt` is a claim about search results, and the honest
 * version of that claim names three separate things: the signed-in console, the
 * machine endpoints, and the anonymous text layers, which are allowed on
 * purpose.
 *
 * Everything not named here is allowed, including the AI crawlers. This site's
 * whole public surface is meant to be read by machines — the `/llms.txt` and
 * `/llms-full.txt` text files exist because they do, and the pages a shared
 * link can point at are the acquisition surface. A
 * `Disallow: /` aimed at GPTBot would be a self-inflicted wound on a site whose
 * product is "fetch this and decide for yourself".
 */

import type { MetadataRoute } from "next"

import { SITE_HOST, siteUrl } from "@/lib/config/site"
import { Routes } from "@/lib/routes"

/**
 * Signed-in surfaces.
 *
 * Listed as prefixes, which is why `/console` covers `/console/repos/[id]` and
 * `/dashboard` covers every list under it without naming each. Nothing here is
 * reachable without a session, so there is nothing for a crawler to index — the
 * redirect to the sign-in form is not a 404, and a crawler that follows it would
 * record the login page as the content of twenty URLs.
 *
 * `/console/decisions` is listed separately rather than folded into `/console`:
 * the proxy's `isPublicPath` prefix-matches these, so folding it would read as
 * though the guard covers it when it does not.
 */
const PRIVATE_PREFIXES = [
  Routes.dashboard,
  Routes.console,
  Routes.decisions,
  Routes.settings,
]

/**
 * The machine endpoints.
 *
 * `Disallow` does not protect them — they carry their own authentication, and the
 * ones that need a credential fail closed on purpose (see `lib/cron/guard.ts`).
 * This is about crawl budget and about honesty: a `/api/trpc` batch URL, a
 * `sync` export page and a cron tick are not documents, and spending a crawl on
 * one costs the crawler time and produces nothing worth indexing.
 *
 * `/api/v1/*` and the two `llms*.txt` layers are the deliberate exception: the
 * former carries its own authentication and fails closed on it, the latter is
 * what agents are meant to fetch. The list below is shaped to make that
 * exception legible — every credentialed prefix is named, so the ones left out
 * are conspicuously absent rather than merely unlisted.
 */
const PRIVATE_API_PREFIXES = [
  "/api/auth",
  "/api/cron",
  "/api/internal",
  "/api/newsletter",
  "/api/skills-sync",
  "/api/trpc",
  "/api/user",
  "/api/webhook",
]

const DISALLOWED = [...PRIVATE_PREFIXES, ...PRIVATE_API_PREFIXES]

/**
 * The crawlers worth naming.
 *
 * Named individually rather than left to `User-agent: *` because each of these
 * respects the most specific group it matches, and an explicit `Allow: /` is the
 * only way to state the intent somewhere the next person to edit this file will
 * see it.
 *
 * `GPTBot` fetches for training, `OAI-SearchBot` fetches for ChatGPT search's
 * index, and `ChatGPT-User` fetches on a user's behalf when they ask a question —
 * three different asks with three different answers to "may I have this site", so
 * all three are listed and none is assumed to imply the others. The same split
 * applies to `ClaudeBot` / `Claude-SearchBot`.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "Baiduspider",
  "DuckAssistBot",
  "cohere-ai",
  "Meta-ExternalAgent",
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOWED },
      // One rule per AI crawler, and that is what Next's renderer can express:
      // `MetadataRoute.Robots` emits a single `User-agent:` line per rule, so
      // there is no way to write one group covering several agents — a value like
      // `"GPTBot\nOAI-SearchBot"` would render as two lines of which only the
      // first is a `User-agent` directive. Repeating identical rules per agent is
      // redundant rather than wrong, and it is the only form in which a reader of
      // the rendered file can see which agent got which rule.
      //
      // The AI groups disallow only the signed-in surfaces, not the API: these
      // agents are the reason the public JSON endpoints exist, and a rule that
      // kept them out of `/api` would defeat the purpose of shipping them.
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: PRIVATE_PREFIXES,
      })),
    ],
    sitemap: siteUrl("/sitemap.xml"),
    host: SITE_HOST,
  }
}
