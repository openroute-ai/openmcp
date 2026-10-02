/**
 * Reading `repos.languages`.
 *
 * The column is declared `jsonb.$type<string[]>()`, and that is the shape the
 * current writer produces: `repo-info-query.ts` flattens GitHub's language
 * nodes to their names before the row is built. But the column predates that
 * writer, and the rows it wrote are still the ones in the database — every
 * non-empty row stores language **objects**, `[{"name": "Clojure"}, ...]`.
 *
 * The type is a claim about the writer, not a guarantee about the column, so a
 * read that trusts it hands React an object where it expects text and the whole
 * page fails: the public project detail renders the primary language, and
 * `languages[0]` on an object row takes the page down with "Objects are not
 * valid as a React child (found: object with keys {name})".
 *
 * So every read of this column goes through here. Both shapes are accepted,
 * neither throws, and the callers get `string[]` — which is what the components
 * were written against and what the column will hold again once every row has
 * been rewritten by the current writer.
 */

/**
 * The language names in a stored `repos.languages`, most significant first.
 *
 * Order is preserved rather than sorted: GitHub already orders the array by
 * bytes descending, and index 0 is the dominant language, which is the fact
 * `primaryLanguage` and the "主语言" field depend on.
 *
 * Unknown entries are dropped instead of stringified. A stored object with no
 * `name` has nothing to render, and `[object Object]` is not an answer.
 */
export function languageNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const names: string[] = []
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry) names.push(entry)
      continue
    }
    if (entry && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name
      if (typeof name === "string" && name) names.push(name)
    }
  }
  return names
}

/**
 * The dominant language, or null when the repository has none recorded.
 *
 * Null rather than an empty string: "未记录" is the honest reading for a
 * repository whose languages were never synced, and the callers render the two
 * differently.
 */
export function primaryLanguage(value: unknown): string | null {
  return languageNames(value)[0] ?? null
}
