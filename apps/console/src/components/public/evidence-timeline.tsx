/**
 * The evidence timeline, as a component.
 *
 * §5.4 red line 2 says no anomaly may be shown without the numbers behind it, and
 * this is where that promise is kept for a single project: every anomaly row is
 * expandable in place, so a reader can check the verdict without leaving the page
 * and without trusting the summary.
 *
 * **Dismissed rows are shown, and shown differently.** They are in the data
 * because "we flagged this last week and later decided it was nothing" is
 * exactly the context a reader needs to judge today's row — hiding it would send
 * them down a road we already walked. The strikethrough and the explicit "已判为
 * 误报" label are what keep that from reading as a live alert.
 *
 * The three non-anomaly event kinds sit in the same strip because they are the
 * answer to the question an anomaly raises. A "release stall" row that cannot be
 * read next to the last release is a claim; next to it, it is a comparison.
 */

"use client"

import {
  IconArrowDownRight,
  IconCircleCheck,
  IconInfoCircle,
  IconLicense,
  IconPlayerSkipForward,
  IconRadar,
  IconTrendingUp,
} from "@tabler/icons-react"
import { useState, type ComponentType } from "react"

import type { AnomalyKind } from "@/db/schema/github"
import type { TimelineEvent } from "@/lib/radar/timeline"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"

type IconType = ComponentType<{
  size?: number
  className?: string
  "aria-hidden"?: boolean
}>

/**
 * Icon per event kind, looked up rather than computed.
 *
 * A lookup because a component built during render is a new component type on
 * every pass, and React remounts on a new type — which would collapse an
 * expanded evidence row every time anything above it re-rendered.
 */
/**
 * Keyed by `anomalyKind ?? kind`, so an anomaly row picks up the icon of the
 * specific signal it is rather than a generic "something happened" one. Falls
 * back to the event kind for the three non-anomaly rows.
 */
const KIND_ICONS: Record<string, IconType> = {
  star_cliff: IconArrowDownRight,
  star_acceleration: IconTrendingUp,
  release_stall: IconPlayerSkipForward,
  commit_stall: IconInfoCircle,
  license_change: IconLicense,
  anomaly: IconRadar,
  release: IconPlayerSkipForward,
  push: IconRadar,
  license: IconLicense,
}

function iconKeyOf(event: TimelineEvent): string {
  return event.anomalyKind ?? event.kind
}

const MUTED = "text-muted-foreground"

/**
 * Colour by the specific signal.
 *
 * Every non-anomaly event is muted on purpose: the strip's job is to make the
 * anomalies readable, and if "a release happened" were also coloured, the eye
 * would have to work out which of the equally-coloured rows is the news.
 */
function toneOf(event: TimelineEvent): string {
  const key = iconKeyOf(event)
  if (key === "star_acceleration") return "text-radar-up"
  if (
    key === "star_cliff" ||
    key === "release_stall" ||
    key === "commit_stall"
  ) {
    return "text-radar-down"
  }
  if (key === "license_change") return "text-amber-600 dark:text-amber-400"
  return MUTED
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function EvidenceTimeline({ events }: { events: TimelineEvent[] }) {
  const [open, setOpen] = useState(false)
  const maxVisible = 5
  const visible = events.slice(0, maxVisible)
  const hasMore = events.length > maxVisible

  if (events.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        这个项目还没有记录到异动、发布或许可证变化。
      </p>
    )
  }

  return (
    <div className="grid gap-2">
      <ol className="grid gap-0">
        {visible.map((event, index) => (
          <TimelineRow
            key={`${event.kind}-${event.at.getTime()}-${index}`}
            event={event}
            last={index === visible.length - 1}
          />
        ))}
      </ol>
      {hasMore ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            aria-label="查看更多证据时间轴"
          >
            查看更多
          </Button>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>证据时间轴</DialogTitle>
          </DialogHeader>
          <ol className="grid gap-0 pt-2">
            {events.map((event, index) => (
              <TimelineRow
                key={`${event.kind}-${event.at.getTime()}-${index}`}
                event={event}
                last={index === events.length - 1}
              />
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * `last` exists so the rail stops at the final row instead of hanging a dangling
 * line below the newest event, which reads as "there is more below" on the
 * element that is by definition the end.
 */
function TimelineRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const Icon = KIND_ICONS[iconKeyOf(event)] ?? IconInfoCircle
  const dismissed = event.status === "dismissed"

  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-4">
      {/* The rail: a dot per event and a connecting line, drawn in CSS rather
          than an SVG chart because it is a decoration for the list's structure,
          not data. */}
      <span className="grid justify-items-center">
        <span
          className={`mt-1 size-2.5 shrink-0 rounded-full border-2 bg-background ${toneOf(event)}`}
        />
        {last ? null : (
          <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
        )}
      </span>

      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          <time dateTime={event.at.toISOString()} className="tabular-nums">
            {formatDate(event.at)}
          </time>
          {dismissed ? (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              <IconCircleCheck size={11} aria-hidden />
              已判为误报
            </span>
          ) : null}
        </div>

        <div className={`flex items-start gap-1.5 text-sm ${toneOf(event)}`}>
          <Icon size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span
            className={
              dismissed ? "text-muted-foreground line-through" : undefined
            }
          >
            {event.title}
          </span>
        </div>

        {event.detail ? (
          <p className="text-xs text-muted-foreground">{event.detail}</p>
        ) : null}

        {event.evidence?.series?.length ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground select-none">
              原始数据（{event.evidence.series.length} 期）
            </summary>
            <ul className="mt-1 grid gap-0.5">
              {event.evidence.series.map((point, pointIndex) => (
                <li
                  key={`${point.label}-${pointIndex}`}
                  className="flex gap-2 tabular-nums"
                >
                  <span className="w-24 shrink-0 text-muted-foreground/70">
                    {point.label}
                  </span>
                  <span>{point.value}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {event.evidence?.notes?.length ? (
          <ul className="text-xs text-muted-foreground">
            {event.evidence.notes.map((note, noteIndex) => (
              <li key={noteIndex}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  )
}

/** The kinds this component can label, exported for the page's own copy. */
export const TIMELINE_KIND_LABELS: Record<
  AnomalyKind | "release" | "push",
  string
> = {
  star_cliff: "增速断崖",
  star_acceleration: "异常加速",
  release_stall: "维护停滞",
  commit_stall: "推送停滞",
  license_change: "许可证变更",
  release: "发布",
  push: "推送",
}
