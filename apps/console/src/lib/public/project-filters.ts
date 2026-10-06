/**
 * The public `/projects` browser: its filter state, sort keys and labels.
 *
 * Everything the filter bar and the page have to agree on lives here, split out
 * of `lib/public/radar.ts` so a client component can render the controls without
 * dragging the database modules into the client bundle. This module is pure and
 * server-agnostic; the reader (`radar.ts`) imports its types and labels, and the
 * controls never import the reader.
 *
 * The only schema import is a type-only `ProjectType`, which erases to nothing at
 * compile time — the runtime vocabulary is the labels object itself, so the
 * schema table definitions never end up in the client bundle.
 */

import type { ProjectType } from "@/db/schema"

/** The orders the browser can be read in, as URL-friendly keys. */
export const PUBLIC_PROJECT_SORTS = ["newest", "stars", "growth"] as const

export type PublicProjectSort = (typeof PUBLIC_PROJECT_SORTS)[number]

export const SORT_LABELS: Record<PublicProjectSort, string> = {
  newest: "最新入库",
  stars: "星数",
  growth: "增长最快",
}

/**
 * The five curation types with the Chinese labels the public site shows.
 *
 * Keyed by the same values as the schema's `PROJECT_TYPES`, asserted against the
 * union so a type added there is caught here. The key list doubles as the closed
 * vocabulary `parseProjectQuery` validates against — a type the URL names that
 * is not in this object is a type that does not exist.
 */
export const PROJECT_TYPE_LABELS = {
  application: "应用",
  skill: "技能",
  client: "客户端",
  server: "服务端",
  persona: "角色",
} as const satisfies Record<ProjectType, string>

/**
 * The state the `/projects` URL encodes, in the one shape both ends share.
 *
 * `q` is always present — "no keyword" is `""` — so the readers can branch on
 * it directly. `sort` defaults to `newest` and is the only field the query
 * string never carries explicitly (see {@link projectsQueryString}).
 */
export interface PublicProjectQuery {
  /** Keywords, already trimmed and length-capped. Empty means no keyword. */
  q: string
  type?: ProjectType
  /** A category code, from the `categories` table. */
  category?: string
  /** A tag code, from the `tags` table. */
  tag?: string
  sort: PublicProjectSort
}

/** One option in one facet rail of the filter bar. */
export interface PublicProjectFacet {
  code: string
  label: string
  count: number
}

/**
 * The facet rails' options with their counts under the *other* filters.
 *
 * `types` carries the type code separately so the value a select submits is the
 * schema's enum value while the label stays the public one.
 */
export interface PublicProjectFacets {
  types: { value: ProjectType; label: string; count: number }[]
  categories: PublicProjectFacet[]
  tags: PublicProjectFacet[]
}

/** A keyword is meaningless past a smoke-test length; the schema has no cap. */
const MAX_KEYWORD_LENGTH = 200

/** Filter codes arrive from the URL; neither the route nor the schema bounds them. */
const MAX_CODE_LENGTH = 100

/**
 * The query from a URL's search params, everything unrecognized dropped.
 *
 * An anonymous page cannot trust a URL; the point of parsing here rather than in
 * SQL is that every bad value is rejected *before* it can reach a query. Types,
 * sorts and codes the schema does not know fall back to their defaults instead
 * of erroring, because a stale shared link should land on the browser, not on a
 * server error.
 */
export function parseProjectQuery(
  raw: Record<string, string | string[] | undefined>
): PublicProjectQuery {
  const q = firstOf(raw.q)?.trim().slice(0, MAX_KEYWORD_LENGTH) ?? ""
  const typeRaw = firstOf(raw.type)
  const category = withCode(raw.category)
  const tag = withCode(raw.tag)
  const sortValue = firstOf(raw.sort)

  return {
    q,
    sort: PUBLIC_PROJECT_SORTS.find((value) => value === sortValue) ?? "newest",
    ...(typeRaw && Object.hasOwn(PROJECT_TYPE_LABELS, typeRaw)
      ? { type: typeRaw as ProjectType }
      : {}),
    ...(category ? { category } : {}),
    ...(tag ? { tag } : {}),
  }
}

/**
 * The URL's page parameter, or `undefined` when absent or not a string.
 *
 * Kept out of {@link PublicProjectQuery} because page number obeys a different
 * rule than the filters — it is clamped against a total that is only known
 * after the list is counted — so the caller reads it separately and runs it
 * through `clampPage`.
 */
export function pageOf(
  raw: Record<string, string | string[] | undefined>
): string | undefined {
  return firstOf(raw.page)
}

/**
 * The query string a URL carries for this state — without the leading `?` and
 * without a `page`, which belongs to the pagination controls and is re-added
 * by them.
 *
 * The default sort is written as "no parameter": the canonical address of the
 * browser's first page is the bare `/projects`, for the same reason the category
 * pages leave `?page=1` off their first page. Page one of the default ordering
 * is a string that can be shared between the nav and the catalog without two
 * spellings of the same shelf.
 */
export function projectsQueryString(query: PublicProjectQuery): string {
  const params = new URLSearchParams()
  if (query.q) params.set("q", query.q)
  if (query.type) params.set("type", query.type)
  if (query.category) params.set("category", query.category)
  if (query.tag) params.set("tag", query.tag)
  if (query.sort !== "newest") params.set("sort", query.sort)
  return params.toString()
}

function firstOf(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

function withCode(value: string | string[] | undefined): string | undefined {
  const code = firstOf(value)?.trim().slice(0, MAX_CODE_LENGTH)
  return code || undefined
}