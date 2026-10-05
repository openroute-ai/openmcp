/**
 * `GET /.well-known/agent.json` — the A2A 0.3 discovery document.
 *
 * The 0.3 spec put the card here and 1.0 moved it to `agent-card.json`, leaving
 * 0.3 clients to fetch a path that no longer exists unless a server keeps both.
 * The two cards carry the same skills; only the envelope differs, so a client
 * that reads either one learns the same capabilities.
 *
 * A redirect is deliberately not used: a redirect would be correct for an HTTP
 * client following hops and wrong for one that does not, and the cost of
 * serving a second small document is far below the cost of an agent that
 * concludes the site has no A2A surface.
 */
import { agentCard, CARD_PATH } from "@/lib/agent/card"

export const dynamic = "force-dynamic"

export function GET(): Response {
  return Response.json(agentCard("0.3"), {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/json; charset=utf-8",
      "x-a2a-card": CARD_PATH["0.3"],
    },
  })
}
