"use client"

import * as React from "react"

import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import type { ProjectType } from "@/db/schema"
import { useLocalePathname, useLocaleRouter } from "@/i18n/navigation"
import {
  PUBLIC_PROJECT_SORTS,
  SORT_LABELS,
  projectsQueryString,
  type PublicProjectFacets,
  type PublicProjectQuery,
} from "@/lib/public/project-filters"

/** How long a pause in typing before a keyword reaches the URL. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * The "off" value of a facet rail.
 *
 * Radix's `Select` has no reserved empty string the way an HTML select does —
 * `value=""` renders the placeholder forever and can never be chosen again —
 * so "全部类型" is a real item with a sentinel value, translated to `""` on
 * the way out. The catalog's URL state stays the same either way: an absent
 * facet is an absent query parameter.
 */
const ALL_FACET = "__all__"

/**
 * The filter bar above the `/projects` catalog.
 *
 * A `<form>` whose controls navigate through the router when JavaScript is
 * loaded, and which can still carry that state to the server without it: the
 * keyword box and the facet rails are real fields, and the current state rides
 * in hidden inputs, so a no-JS reader submits a `GET` that renders the same
 * URL. The facet rails themselves are shadcn `Select`s — themed like the rest
 * of the site — which means their choice needs JavaScript to be *made*, which
 * is what the hidden inputs are for: they hold the committed values so a plain
 * submit preserves them.
 *
 * The two navigation modes encode what each control is *doing*: a keyword edit
 * rewrites the current URL (replace), because every pause while typing is a draft
 * rather than a page to go back to; a facet, sort or clear choice is a commit
 * (push), because it is a deliberate new framing of the list. Non-default state
 * only is written to the URL (see `projectsQueryString`), so the canonical
 * address of the plain catalog stays the bare `/projects`.
 */
export function ProjectsFilterBar({
  query,
  facets,
  action,
}: {
  query: PublicProjectQuery
  facets: PublicProjectFacets
  /** The bare action path, locale-prefixed, for the no-JS `GET`. */
  action: string
}) {
  const router = useLocaleRouter()
  const pathname = useLocalePathname()

  const [q, setQ] = React.useState(query.q)
  const lastAppliedQ = React.useRef(query.q)
  const debounceTimer = React.useRef<number | null>(null)

  /** The state the URL currently encodes, plus whatever is being drafted. */
  const current = React.useCallback(
    (overrides: Partial<PublicProjectQuery> = {}): PublicProjectQuery => ({
      q: q.trim(),
      type: query.type,
      category: query.category,
      tag: query.tag,
      sort: query.sort,
      ...overrides,
    }),
    [q, query]
  )

  /**
   * Writes `next` to the URL, keeping the debounce bookkeeping in step.
   *
   * Always cancels a pending keyword replace: a commit (facet, sort, submit)
   * must not be overwritten a moment later by a draft that was drawn from the
   * props as they stood before the navigation landed.
   */
  const apply = React.useCallback(
    (next: PublicProjectQuery, mode: "push" | "replace" = "push") => {
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      lastAppliedQ.current = next.q
      const search = projectsQueryString(next)
      const href = search ? `${pathname}?${search}` : pathname
      if (mode === "push") void router.push(href, { scroll: false })
      else void router.replace(href, { scroll: false })
    },
    [pathname, router]
  )

  // Back/forward, or a no-JS submit, renders with a different keyword; the input
  // follows. A value this component just wrote is untouched, so a half-typed
  // draft is never overwritten by its own echo.
  React.useEffect(() => {
    if (query.q !== lastAppliedQ.current) {
      lastAppliedQ.current = query.q
      setQ(query.q)
    }
  }, [query.q])

  // Each pause while typing rewrites the URL in place. `lastAppliedQ` guards the
  // mount (the prop is already the current value) and every apply: without the
  // guard, the effect would immediately replace the URL with the same state.
  React.useEffect(() => {
    const trimmed = q.trim()
    if (trimmed === lastAppliedQ.current) return
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    debounceTimer.current = window.setTimeout(() => {
      debounceTimer.current = null
      apply(current({ q: trimmed }), "replace")
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceTimer.current !== null) {
        window.clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
    }
  }, [apply, current, q])

  /** The Enter key or the 搜索 button, routing instead of submitting. */
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    apply(current(), "push")
  }

  function clear() {
    setQ("")
    apply({ q: "", sort: query.sort }, "push")
  }

  const filtered = Boolean(query.q || query.type || query.category || query.tag)

  return (
    <form
      method="get"
      action={action}
      onSubmit={onSubmit}
      className="grid gap-3 text-sm"
    >
      {/*
       * The committed state, in fields a browser submits without JavaScript.
       * The razor-shave: the facet rails are `Select`s whose choice itself
       * needs JS, so on a JS-less submit these carry the last committed
       * values — which are exactly what the Selects display. The sort rides
       * here rather than on the chips because an implicit form submission
       * submits the first sorting chip as its button, which would silently
       * drop the stars sort for a stars URL.
       */}
      <input type="hidden" name="type" value={query.type ?? ""} />
      <input type="hidden" name="category" value={query.category ?? ""} />
      <input type="hidden" name="tag" value={query.tag ?? ""} />
      <input type="hidden" name="sort" value={query.sort} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="搜索项目名、作者或描述"
          aria-label="搜索关键词"
          className="h-9 w-full min-w-0 sm:w-64"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
          <span className="mr-1 text-xs text-muted-foreground">排序：</span>
          {PUBLIC_PROJECT_SORTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={query.sort === value}
              onClick={() => apply(current({ sort: value }), "push")}
              className={sortChipClass(query.sort === value)}
            >
              {SORT_LABELS[value]}
            </button>
          ))}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FacetSelect
          ariaLabel="按类型筛选"
          value={query.type ?? ""}
          noneLabel="全部类型"
          options={facets.types.map((type) => ({
            id: type.value,
            label: type.label,
            count: type.count,
          }))}
          onChange={(value) =>
            apply(
              current({ type: (value || undefined) as ProjectType | undefined }),
              "push"
            )
          }
        />
        <FacetSelect
          ariaLabel="按分类筛选"
          value={query.category ?? ""}
          noneLabel="全部分类"
          options={facets.categories.map((category) => ({
            id: category.code,
            label: category.label,
            count: category.count,
          }))}
          onChange={(value) =>
            apply(current({ category: value || undefined }), "push")
          }
        />
        <FacetSelect
          ariaLabel="按标签筛选"
          value={query.tag ?? ""}
          noneLabel="全部标签"
          options={facets.tags.map((tag) => ({
            id: tag.code,
            label: tag.label,
            count: tag.count,
          }))}
          onChange={(value) =>
            apply(current({ tag: value || undefined }), "push")
          }
        />
        {filtered ? (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            清除筛选
          </button>
        ) : null}
        <button
          type="submit"
          className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          搜索
        </button>
      </div>
    </form>
  )
}

/**
 * One facet rail: a shadcn `Select`, sized to match the search box beside it.
 *
 * The counts ride inside the item labels because a reader comparing rail
 * counts needs them beside the names, not a row below. The sentinel item is
 * the "off" state; `onChange` translates it away so the caller only ever sees
 * a facet value or nothing.
 */
function FacetSelect({
  ariaLabel,
  value,
  noneLabel,
  options,
  onChange,
}: {
  ariaLabel: string
  value: string
  noneLabel: string
  options: { id: string; label: string; count: number }[]
  onChange: (value: string) => void
}) {
  return (
    <Select
      value={value || ALL_FACET}
      onValueChange={(raw) => onChange(raw === ALL_FACET ? "" : raw)}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-9 min-w-0 gap-1 rounded-lg text-sm tabular-nums"
      >
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_FACET}>{noneLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}（{option.count}）
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function sortChipClass(active: boolean): string {
  return active
    ? "rounded-lg bg-accent px-2.5 py-1 font-medium text-accent-foreground"
    : "rounded-lg px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
}