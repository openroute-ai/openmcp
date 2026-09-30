"use client"

import * as React from "react"

/** How tall a full bar is, in pixels. */
const MAX_BAR_HEIGHT = 120

export interface StarBar {
  key: string
  label: string
  value: number | undefined
  /** The full label, for the tooltip and the small-screen readout. */
  title: string
}

/**
 * A row of bars, one per day, week or month.
 *
 * The bars are plain divs rather than a chart library: there is one series, it
 * is a few dozen values, and nothing here needs axes, zoom or a legend. A
 * library would add a dependency and a client bundle to render a few dozen
 * rectangles.
 *
 * Every bar is a button, so a value is reachable by keyboard and readable by a
 * screen reader through the same `title` the tooltip shows. The value is not
 * rendered as visible text above each bar because the numbers collide with each
 * other and with the bar tops at every width below a wide desktop; the selected
 * bar's value is shown in a readout instead, which is also the only way to read
 * one on a phone.
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
}: {
  bars: StarBar[]
  emptyLabel: string
  /** Shown above the bars while nothing is selected. */
  hint: string
  /** Formats the selected bar for the readout and the screen-reader text. */
  readout: (bar: StarBar) => string
}) {
  const [selected, setSelected] = React.useState<string | null>(null)

  // Scaled against the largest value present, and over the absolute values
  // rather than the deltas: a repository that gained 12 stars every day for a
  // month should show thirty equal bars, not thirty bars scaled to whichever
  // day happened to spike.
  const values = bars
    .map((bar) => bar.value)
    .filter((value): value is number => value !== undefined)
  const max = values.length > 0 ? Math.max(...values, 0) : 0

  const current = bars.find((bar) => bar.key === selected)

  if (values.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <div className="grid gap-2">
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {current ? readout(current) : hint}
      </p>

      <div className="flex items-end gap-1">
        {bars.map((bar) => {
          const height =
            bar.value === undefined
              ? 0
              : max === 0
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
              aria-label={bar.title}
              aria-pressed={isSelected}
              title={bar.title}
              className="flex flex-1 flex-col items-center justify-end disabled:cursor-default"
            >
              <span
                className={
                  bar.value === undefined
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

      <div className="flex gap-1 text-xs text-muted-foreground">
        {bars.map((bar) => (
          <span key={bar.key} className="flex-1 text-center">
            {bar.label}
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
