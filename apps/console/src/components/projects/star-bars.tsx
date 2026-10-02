"use client"

import * as React from "react"

/** How tall a full bar is, in pixels. */
const MAX_BAR_HEIGHT = 120

/** How wide the tooltip is, in pixels, used to keep it inside the chart. */
const TOOLTIP_WIDTH = 236

/** How many axis labels a chart draws, however many bars it has. */
const MAX_AXIS_LABELS = 8

/**
 * Stands in for a measure nobody recorded.
 *
 * An em dash rather than a zero or an empty cell, because both of those read as
 * "nothing happened" where the truth is "we did not look".
 */
export const UNMEASURED = "\u2014"

export interface StarBar {
  key: string
  label: string
  value: number | undefined
  /** The full label, for the tooltip and the small-screen readout. */
  title: string
  /**
   * What this period recorded, one row per measure. Absent for a caller that has
   * nothing beyond the bar's own value to say, which then falls back to the
   * native `title`.
   */
  tooltip?: StarBarTooltipRow[]
}

/**
 * One measure inside a bar's tooltip: the level the period ended at, and the
 * movement over the period.
 *
 * Both are already formatted by the caller, because "unmeasured" and "no change"
 * read differently per measure and this component should not decide which.
 */
export interface StarBarTooltipRow {
  label: string
  /** The level at the end of the period. */
  current: string
  /** Movement over the period, or null when it was not measured. */
  change: string | null
}

/**
 * A row of bars, one per day, week or month.
 *
 * The bars are plain divs rather than a chart library: there is one series, it
 * is a few dozen values, and nothing here needs axes, zoom or a legend. A
 * library would add a dependency and a client bundle to render a few dozen
 * rectangles.
 *
 * Laid out as a grid of `minmax(0, 1fr)` columns rather than as flex items. Both
 * let a bar shrink, but only the grid can also shrink a column holding text: a
 * flex item's width is its content's, so ninety date labels sized themselves to
 * the longest one and pushed the chart out of its container. `minmax(0, 1fr)` is
 * a request for a column that may be narrower than its contents, and `truncate`
 * then has something to truncate against.
 *
 * Only a handful of labels are drawn, evenly spaced and always including the
 * first and last bar, because a label under every bar of a ninety-bar chart is
 * unreadable at any width rather than dense.
 *
 * Every bar is a button, so a value is reachable by keyboard and readable by a
 * screen reader. Hovering or focusing one opens a tooltip anchored to it; a
 * click pins it, which is the only way to open one on a touch screen. The
 * selected bar's value is also shown in a readout, so the tooltip is never the
 * sole route to a number.
 *
 * Presentation only: every string arrives as a prop rather than from
 * `useTranslations`, so the dashboard's `ProjectDetail` namespace and the public
 * project's Chinese copy can share this without either owning the other's
 * messages. `readout` is a function for the same reason — the two callers format
 * a selected bar differently. The unit is part of that per-caller wording and
 * travels in `bar.title`, so this component never needs to know it.
 */
export function StarBarChart({
  bars,
  emptyLabel,
  hint,
  readout,
  tooltipHeaders,
}: {
  bars: StarBar[]
  emptyLabel: string
  /** Shown above the bars while nothing is selected. */
  hint: string
  /** Formats the selected bar for the readout and the screen-reader text. */
  readout: (bar: StarBar) => string
  /**
   * The tooltip's column headings, from the caller for the same reason the rest
   * of the copy is: this component translates nothing. Omitted when the caller
   * has no tooltip rows to label.
   */
  tooltipHeaders?: {
    label: string
    current: string
    change: string
  }
}) {
  const [selected, setSelected] = React.useState<string | null>(null)
  const [hovered, setHovered] = React.useState<string | null>(null)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [trackWidth, setTrackWidth] = React.useState(0)

  // The tooltip is positioned from the bar's own fraction of the track, which
  // needs the track's pixel width to clamp at both ends: without it, a card
  // centred on the first or last bar hangs half outside the chart.
  React.useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setTrackWidth(entry.contentRect.width)
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  // Scaled against the largest value present, and over the absolute values
  // rather than the deltas: a repository that gained 12 stars every day for a
  // month should show thirty equal bars, not thirty bars scaled to whichever
  // day happened to spike.
  const values = bars
    .map((bar) => bar.value)
    .filter((value): value is number => value !== undefined)
  const max = values.length > 0 ? Math.max(...values, 0) : 0

  const current = bars.find((bar) => bar.key === selected)
  const hasAnyValue = values.some((v) => v > 0)

  if (values.length === 0) {
    return (
      <div className="grid min-w-0 gap-2">
        <p className="h-5 text-sm text-muted-foreground">{emptyLabel}</p>
        <div
          className="grid items-end gap-px border-b border-dashed border-muted-foreground/20"
          style={{
            gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`,
            minHeight: `${MAX_BAR_HEIGHT + 8}px`,
          }}
          aria-hidden
        />
      </div>
    )
  }

  const columns = `repeat(${bars.length}, minmax(0, 1fr))`
  const labelled = new Set(labelIndexes(bars.length))
  const activeKey = hovered ?? selected
  const activeIndex = activeKey
    ? bars.findIndex((bar) => bar.key === activeKey)
    : -1
  const active = activeIndex >= 0 ? bars[activeIndex] : undefined
  const tipLeft =
    activeIndex >= 0 && trackWidth > 0
      ? clamp(
          (activeIndex + 0.5) * (trackWidth / bars.length),
          TOOLTIP_WIDTH / 2 + 4,
          trackWidth - TOOLTIP_WIDTH / 2 - 4
        )
      : 0

  return (
    <div className="grid min-w-0 gap-2">
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {current ? readout(current) : hint}
      </p>

      <div className="relative min-w-0" ref={trackRef}>
        {active?.tooltip && active.tooltip.length > 0 ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-10 mb-2 w-[236px] rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
            style={{ left: tipLeft, transform: "translateX(-50%)" }}
          >
            <p className="mb-1 truncate text-xs font-medium">{active.title}</p>
            <table className="w-full text-xs">
              {tooltipHeaders ? (
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-0.5 text-left font-normal">
                      {tooltipHeaders.label}
                    </th>
                    <th className="py-0.5 text-right font-normal">
                      {tooltipHeaders.current}
                    </th>
                    <th className="py-0.5 text-right font-normal">
                      {tooltipHeaders.change}
                    </th>
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {active.tooltip.map((row) => (
                  <tr key={row.label}>
                    <td className="py-0.5 pr-2">{row.label}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {row.current}
                    </td>
                    <td
                      className={
                        row.change === null
                          ? "py-0.5 text-right text-muted-foreground tabular-nums"
                          : row.change.startsWith("-")
                            ? "py-0.5 text-right text-destructive tabular-nums"
                            : "py-0.5 text-right tabular-nums"
                      }
                    >
                      {row.change ?? UNMEASURED}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div
          className="grid items-end gap-px"
          style={{
            gridTemplateColumns: columns,
            minHeight: `${MAX_BAR_HEIGHT + 8}px`,
          }}
        >
          {bars.map((bar) => {
            const height =
              bar.value === undefined || !hasAnyValue || max <= 0
                ? 0
                : Math.max(2, Math.round((bar.value / max) * MAX_BAR_HEIGHT))
            const isSelected = bar.key === selected

            return (
              <button
                key={bar.key}
                type="button"
                // A bar with no value is drawn as a gap and is not focusable:
                // there is nothing behind it to read.
                disabled={bar.value === undefined}
                onClick={() => setSelected(isSelected ? null : bar.key)}
                onMouseEnter={() => setHovered(bar.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(bar.key)}
                onBlur={() => setHovered(null)}
                aria-label={bar.title}
                aria-pressed={isSelected}
                // The custom tooltip replaces the native one only when there is
                // something to show in it; two tooltips for one bar is worse
                // than either.
                title={bar.tooltip ? undefined : bar.title}
                className="flex min-w-0 justify-end disabled:cursor-default"
              >
                <span
                  className={
                    bar.value === undefined || !hasAnyValue
                      ? "w-3/4 border-b border-dashed border-muted-foreground/40"
                      : isSelected
                        ? "w-3/4 rounded-t bg-primary"
                        : "w-3/4 rounded-t bg-primary/40 hover:bg-primary/60"
                  }
                  style={{ height }}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="grid gap-px text-xs text-muted-foreground"
        style={{ gridTemplateColumns: columns }}
      >
        {bars.map((bar, index) => (
          <span
            key={bar.key}
            className={
              labelled.has(index) ? "min-w-0 truncate text-center" : "min-w-0"
            }
          >
            {labelled.has(index) ? bar.label : null}
          </span>
        ))}
      </div>

      <p className="sr-only">
        {bars
          .filter((bar) => bar.value !== undefined)
          .map((bar) => readout(bar))
          .join("; ")}
      </p>
    </div>
  )
}

/**
 * Which bars get an axis label: an even spread of at most `MAX_AXIS_LABELS`,
 * always including the first and last bar.
 *
 * The endpoints because they are what dates an otherwise unlabelled run, and the
 * rest evenly spaced because an even stride keeps the gaps the same width, which
 * is what makes the spacing readable rather than arbitrary.
 */
function labelIndexes(count: number): number[] {
  if (count <= MAX_AXIS_LABELS) {
    return Array.from({ length: count }, (_, index) => index)
  }

  const stride = (count - 1) / (MAX_AXIS_LABELS - 1)
  const indexes = new Set<number>()
  for (let step = 0; step < MAX_AXIS_LABELS; step += 1) {
    indexes.add(Math.round(step * stride))
  }
  return [...indexes].sort((a, b) => a - b)
}

function clamp(value: number, min: number, max: number): number {
  // A container narrower than the tooltip would otherwise ask for a negative
  // range; centring it is the only sensible answer there.
  if (max < min) return (min + max) / 2
  return Math.min(Math.max(value, min), max)
}
