/**
 * `GET /atom.xml` — the Atom feed.
 *
 * The same entries as `/feed.xml` in the other serialisation: Atom clients
 * exist, the entry list is built once in `lib/seo/feed`, and the only thing
 * that differs between the two URLs is the XML around it. Two routes rather
 * than one with content negotiation, because a subscriber stores the URL once
 * and a `Feed`-header negotiation it did not ask for is a surprise it has to
 * encode in its own config.
 */
import { feedEntries, renderAtom } from "@/lib/seo/feed"

export const revalidate = 3600

export async function GET(): Promise<Response> {
  const entries = await feedEntries()

  return new Response(renderAtom(entries), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  })
}
