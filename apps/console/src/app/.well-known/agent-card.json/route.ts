/**
 * `GET /.well-known/agent-card.json` — the A2A 1.0 discovery document.
 *
 * The path is fixed by the spec (§8.2), so it cannot be moved for tidiness: a
 * client is told to look here and looks here. It needs no entry in
 * `PublicRoutes` — the proxy matcher skips anything with a file extension in its
 * last segment, which this path has — but it does need a `robots.ts` allowance,
 * because a well-known document that `Disallow`s itself is a document no crawler
 * will fetch.
 */
import { agentCard, CARD_PATH } from "@/lib/agent/card"

/**
 * Recomputed per request rather than hoisted to a module constant.
 *
 * The card carries the site's description and provider URL from the environment,
 * and those are deployment configuration. Building it once at module load would
 * bake in whichever environment happened to import the module first.
 */
export const dynamic = "force-dynamic"

export function GET(): Response {
  return Response.json(agentCard("1.0"), {
    headers: {
      // §8.6 asks for cache-friendly serving; an hour is short enough that a
      // description edit reaches clients without a deploy.
      "cache-control": "public, max-age=3600",
      "content-type": "application/json; charset=utf-8",
      "x-a2a-card": CARD_PATH["1.0"],
    },
  })
}
