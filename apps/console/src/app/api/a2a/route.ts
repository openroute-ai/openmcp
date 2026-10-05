/**
 * `POST /api/a2a` — the JSON-RPC endpoint the card points at.
 *
 * Under `/api/` on purpose. The card must live at `/.well-known/agent-card.json`
 * because the spec fixes that path, but the endpoint does not have to sit next
 * to it, and `isPublicPath()` only matches exact paths and string prefixes — a
 * glob like `/.well-known/**` would not pass through it, so an endpoint at
 * `/.well-known/agent` would be caught by the auth gate and 307'd to a sign-in
 * form. `/api/` is already excluded by the proxy matcher, which means no auth
 * bypass is needed and none is granted.
 *
 * Anonymous by design, bounded per address inside the handler.
 */
import { handleA2ARequest } from "@/lib/agent/rpc"

export const dynamic = "force-dynamic"

/**
 * Only POST exists. A2A is JSON-RPC over HTTP, and answering GET with a usage
 * note rather than a 405 would invite a client to parse an HTML page as a card.
 */
export function POST(request: Request): Promise<Response> {
  return handleA2ARequest(request)
}

export function GET(): Response {
  return Response.json(
    {
      error: "method_not_allowed",
      message:
        "A2A 是 JSON-RPC over HTTP，请用 POST 调用本端点。Agent Card 见 /.well-known/agent-card.json。",
    },
    {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: "POST",
      },
    }
  )
}
