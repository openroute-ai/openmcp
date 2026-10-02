import type { JsonLd, JsonLdNode } from "@/lib/seo/structured-data"

/**
 * Renders one JSON-LD node as a `<script>`.
 *
 * Rendered in the document rather than injected on the client: structured data is
 * read from the HTML a crawler fetched, and a crawler that does not execute
 * JavaScript would otherwise find nothing. React escapes the text content of a
 * `<script>` child exactly once, which is not enough on its own — see
 * {@link serialize} for the second half.
 */
export function JsonLd({ node }: { node: JsonLd | JsonLdNode | JsonLdNode[] }) {
  const payload: JsonLd = Array.isArray(node)
    ? { "@context": "https://schema.org", "@graph": node }
    : { "@context": "https://schema.org", ...node }

  return (
    <script
      type="application/ld+json"
      // The only `dangerouslySetInnerHTML` in the app. The lint rule that
      // objects to it is enabled rather than silenced: it is right that a raw
      // HTML string is unescaped input, and what makes this one safe is
      // {@link serialize}, not an exception to the rule.
      dangerouslySetInnerHTML={{ __html: serialize(payload) }}
    />
  )
}

/**
 * `JSON.stringify`, minus the three ways its output can break the document.
 *
 * `<` and `>` are escaped to their `\u` forms. That is not cosmetic: any string
 * this site renders — a repository description, a blog body, an author's name —
 * can contain the characters that close a `<script>` element, and HTML parsers do
 * not know that the content inside `<script>` is JSON, so an unescaped one ends
 * the block early and turns the rest of the node into visible text. Both escapes
 * parse back to the original characters, so nothing is lost.
 *
 * U+2028 and U+2029 are escaped for the second reason. They are valid *string
 * content* in JSON but not valid JSON whitespace, so one inside a description
 * serialises to output that `JSON.parse` — and therefore every consumer that
 * takes these nodes seriously — rejects.
 *
 * The pattern is written with `\u` escapes rather than the literal characters:
 * the literals are invisible in an editor and in a diff, which is the wrong
 * property for something whose entire job is to be noticed.
 */
function serialize(payload: JsonLd): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}
