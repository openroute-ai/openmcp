"use client"

import * as React from "react"
import {
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconInfoCircle,
  IconLayoutGrid,
  IconList,
  IconStar,
  IconTrendingDown,
} from "@tabler/icons-react"

import { ProjectLogo } from "@/components/projects/project-logo"
import { LocaleLink } from "@/i18n/navigation"

/**
 * Every public list of projects, in one place.
 *
 * The rankings, the category pages and the related-projects rail all answer the
 * same question — which projects are these, and what are their numbers — and
 * three hand-written tables meant three places to add the logo, the tags and the
 * view switch. This is that list, so a project row looks the same wherever a
 * reader meets one.
 *
 * A client component because the view switch is state. The data still arrives as
 * props from a server component, so nothing here fetches.
 *
 * `groups` rather than one list, because the rankings page shows the current and
 * the previous period side by side and one toggle has to apply to both: a reader
 * who switched to the grid expects both lists to be grids, and a toggle per group
 * would let the page end up disagreeing with itself.
 */
export interface PublicProjectItem {
  id: string
  owner: string
  name: string
  fullName: string
  description: string
  stars: number
  type: string
  status: string
  tags: string[]
  logo: string | null
  iconUrl: string | null
  /** The owner's GitHub avatar, preferred over the repository icon. */
  avatar?: string | null
  /** Movement over the ranked period, absent where the list is not a ranking. */
  delta?: number
  /**
   * Growth as a fraction of the count before the period, on lists that rank on
   * the ratio rather than the absolute gain.
   *
   * Present together with `growthBase`: a percentage on its own is the one
   * number on this site that can be true and useless at the same time (4 → 8
   * stars is +100%), so the denominator travels with it and is rendered on the
   * same row. Absent where the list ranks on absolute gain.
   */
  relativeGrowth?: number | null
  /** The count before the period — the denominator of `relativeGrowth`. */
  growthBase?: number
  /**
   * The project's most severe open anomaly, when it has one.
   *
   * Rendered on the row rather than behind a click (§5.9.3): the row is the
   * cheapest place to say "this one is also going bad", and a badge a reader has
   * to go looking for is a badge nobody sees. Absent on lists that are not
   * rankings — a category listing has no period to relate an anomaly to.
   */
  anomaly?: {
    kind: string
    severity: string
    title: string
  } | null
}

export interface PublicProjectGroup {
  /** The period heading, e.g. `本周` or `上周`. */
  title: string
  /** The period itself, e.g. `2026 第 38 周`, shown beside the heading. */
  periodLabel?: string
  /** What the delta column counts, e.g. `本周增量`. */
  deltaLabel?: string
  /** What `growthBase` is, e.g. `上周 3,876 星`. Absent when there is no ratio. */
  growthBaseLabel?: string
  items: PublicProjectItem[]
  /** Shown when the period has no rows at all. */
  emptyLabel: string
}

/**
 * The row's anomaly badge.
 *
 * Icon plus label plus border, never colour alone — §5.9.2. A reader who has
 * learned "red means bad" everywhere else would read this site's red (which
 * means growing) backwards, so the label is what carries the meaning and the
 * colour only repeats it.
 *
 * `down` is green here for the same reason: a falling project is the good news
 * on a site whose job is to tell you which projects to stop betting on.
 */
function AnomalyBadge({
  anomaly,
}: {
  anomaly: NonNullable<PublicProjectItem["anomaly"]>
}) {
  const Icon =
    anomaly.kind === "star_cliff"
      ? IconTrendingDown
      : anomaly.severity === "risk"
        ? IconAlertTriangle
        : IconInfoCircle

  return (
    <span
      title={anomaly.title}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-l-2 border-radar-down px-1.5 py-0.5 text-xs font-medium text-radar-down"
    >
      <Icon size={12} aria-hidden />
      异动
    </span>
  )
}

export function PublicProjectBoard({
  groups,
}: {
  groups: PublicProjectGroup[]
}) {
  const [view, setView] = React.useState<"list" | "grid">("list")

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-end gap-1">
        <ViewButton
          active={view === "list"}
          label="列表视图"
          onClick={() => setView("list")}
        >
          <IconList className="size-4" aria-hidden />
        </ViewButton>
        <ViewButton
          active={view === "grid"}
          label="卡片视图"
          onClick={() => setView("grid")}
        >
          <IconLayoutGrid className="size-4" aria-hidden />
        </ViewButton>
      </div>

      {groups.map((group) => (
        <section key={group.title} className="grid gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2">
            <h2 className="font-display text-lg font-bold tracking-tight">
              {group.title}
            </h2>
            {group.periodLabel ? (
              <span className="text-xs text-muted-foreground">
                {group.periodLabel}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {group.items.length} 个项目
            </span>
          </div>

          {group.items.length === 0 ? (
            <p className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
              {group.emptyLabel}
            </p>
          ) : view === "list" ? (
            <ProjectRows group={group} />
          ) : (
            <ProjectCards group={group} />
          )}
        </section>
      ))}
    </div>
  )
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={
        active
          ? "rounded-md bg-primary p-1.5 text-primary-foreground"
          : "rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      }
    >
      {children}
    </button>
  )
}

/**
 * One project per row: what a reader scanning a ranking needs, in one line.
 *
 * The row is a container rather than one big link because the tags are links of
 * their own, and a link inside a link is not a thing — the browser closes the
 * outer one and the row stops being clickable at all. Instead the name carries a
 * stretched link that covers the row, and the tags sit above it.
 */
function ProjectRows({ group }: { group: PublicProjectGroup }) {
  return (
    <ul className="grid gap-px overflow-hidden rounded-xl border border-border bg-border">
      {group.items.map((item, index) => (
        <li
          key={item.id}
          className="relative bg-background transition-colors hover:bg-accent/50"
        >
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
            <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>

            <span className="grid min-w-0 gap-1">
              <span className="flex min-w-0 items-center gap-2">
                <ProjectLogo
                  name={item.name}
                  logo={item.logo}
                  avatar={item.avatar}
                  iconUrl={item.iconUrl}
                  className="size-6"
                />
                <ProjectLink item={item} className="min-w-0">
                  <span className="truncate text-sm font-medium">
                    {item.fullName}
                  </span>
                </ProjectLink>
                {item.status === "deprecated" ? (
                  <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                    已弃用
                  </span>
                ) : null}
                {item.anomaly ? <AnomalyBadge anomaly={item.anomaly} /> : null}
              </span>
              {item.description ? (
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
              <TagRow tags={item.tags} />
            </span>

            <span className="grid shrink-0 justify-items-end gap-1 text-right">
              <span className="text-sm tabular-nums">
                {item.stars.toLocaleString("en-US")}
                <IconStar className="mb-0.5 ml-1 inline size-3" aria-hidden />
              </span>
              {item.relativeGrowth != null ? (
                <span className="text-xs font-semibold text-radar-up tabular-nums">
                  {formatPercent(item.relativeGrowth)}
                </span>
              ) : null}
              {item.delta !== undefined ? (
                <span
                  className={
                    item.relativeGrowth == null
                      ? item.delta >= 0
                        ? "text-xs font-semibold text-radar-up tabular-nums"
                        : "text-xs font-semibold text-radar-down tabular-nums"
                      : "text-xs text-muted-foreground tabular-nums"
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {item.delta >= 0 ? (
                      <IconArrowUpRight size={12} />
                    ) : (
                      <IconArrowDownRight size={12} />
                    )}
                    {signed(item.delta)}
                  </span>
                </span>
              ) : null}
              {item.growthBase != null && group.growthBaseLabel ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.growthBaseLabel} {item.growthBase.toLocaleString("en-US")} 星
                </span>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** One project per card, for reading the list rather than scanning it. */
function ProjectCards({ group }: { group: PublicProjectGroup }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {group.items.map((item) => (
        <li
          key={item.id}
          className="relative grid h-full content-start gap-2 rounded-xl border border-border p-4 transition-colors hover:bg-accent/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ProjectLogo
              name={item.name}
              logo={item.logo}
              avatar={item.avatar}
              iconUrl={item.iconUrl}
              className="size-8"
            />
            <span className="grid min-w-0 gap-0.5">
              <ProjectLink item={item} className="min-w-0">
                <span className="truncate text-sm font-medium">
                  {item.fullName}
                </span>
              </ProjectLink>
              {item.type || item.status !== "active" ? (
                <span className="text-xs text-muted-foreground">
                  {[item.type, item.status === "deprecated" ? "已弃用" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {item.anomaly ? <AnomalyBadge anomaly={item.anomaly} /> : null}
            </span>
          </span>

          {item.description ? (
            <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </span>
          ) : null}

          <TagRow tags={item.tags} />

          <span className="mt-auto grid justify-items-end gap-1 pt-1 text-right text-sm tabular-nums">
            <span>
              {item.stars.toLocaleString("en-US")}
              <IconStar className="mb-0.5 ml-1 inline size-3" aria-hidden />
            </span>
            {item.relativeGrowth != null ? (
              <span className="text-xs font-semibold text-radar-up">
                {formatPercent(item.relativeGrowth)}
              </span>
            ) : null}
            {item.delta !== undefined ? (
              <span
                className={
                  item.relativeGrowth == null
                    ? item.delta >= 0
                      ? "text-xs font-semibold text-radar-up"
                      : "text-xs font-semibold text-radar-down"
                    : "text-xs text-muted-foreground"
                }
              >
                {group.deltaLabel ? `${group.deltaLabel} ` : ""}
                {signed(item.delta)}
              </span>
            ) : null}
            {item.growthBase != null && group.growthBaseLabel ? (
              <span className="text-xs text-muted-foreground">
                {group.growthBaseLabel} {item.growthBase.toLocaleString("en-US")} 星
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * A link to one project, stretched over whatever row or card contains it.
 *
 * The stretch is what makes a whole row clickable without wrapping the row in an
 * anchor, and `z-10` on the sibling tag links keeps them clickable on top of it.
 * A link's own class stays whatever the caller needs — the card's numbers need no
 * styling of their own, since the stretched link already covers them.
 */
function ProjectLink({
  item,
  className,
  children,
}: {
  item: PublicProjectItem
  className?: string
  children: React.ReactNode
}) {
  return (
    <LocaleLink
      href={`/projects/${item.owner}/${item.name}`}
      className={`relative before:absolute before:inset-0 before:content-[''] hover:underline ${className ?? ""}`}
    >
      {children}
    </LocaleLink>
  )
}

function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null

  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <LocaleLink
          key={tag}
          href={`/categories/${tag}`}
          className="relative z-10 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {tag}
        </LocaleLink>
      ))}
    </span>
  )
}

/** Formats a gain with its sign, the way a reader scans a delta column. */
function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`
}

/**
 * Formats a growth ratio with its sign.
 *
 * `growthBase` is rendered next to it on the same row (see
 * {@link PublicProjectItem.relativeGrowth}), because a signed percentage is the one
 * number here that can be both correct and useless on its own.
 */
function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`
}
