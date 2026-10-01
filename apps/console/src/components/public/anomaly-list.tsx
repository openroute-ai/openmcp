/**
 * The anomaly list, as a component.
 *
 * Shared by `/anomalies` and the landing hero's live feed, so the two cannot
 * disagree about what an anomaly looks like. It renders whatever `listOpenAnomalies`
 * returned, in the order it returned it: the sort lives in the query (severity,
 * then magnitude, then recency) rather than here, because §5.9.4's ordering is a
 * claim about what matters and that claim belongs with the data.
 *
 * Two rules from the design doc are load-bearing rather than cosmetic:
 *
 * **Alerts do not rely on colour.** §5.9.2 requires shape plus text plus a border
 * for anything risk-coloured, because the down direction is *green* here and a
 * reader who has learned "red means bad" from everywhere else on the web will
 * read this page backwards. Every flag carries an icon and a label; the colour is
 * redundant reinforcement, never the message.
 *
 **The evidence is on the row, not behind a click.** Red line 2 in §5.4 is that
 * no anomaly may be shown without the numbers behind it, so the series is rendered
 * inline and expandable rather than fetched on demand. A reader who trusts us has
 * to be able to check us without leaving the list.
 */

import {
  IconArrowDownRight,
  IconLicense,
  IconPlayerSkipForward,
  IconAlertTriangle,
  IconInfoCircle,
  IconTrendingUp,
} from "@tabler/icons-react"
import type { ComponentType } from "react"
import { LocaleLink } from "@/i18n/navigation"
import type { AnomalyKind, AnomalySeverity } from "@/db/schema/github"
import type { AnomalyWithRepo } from "@/lib/radar/anomalies"

/**
 * One flag's presentation: icon, label, and the unit its magnitude is in.
 *
 * The unit is the reason this table exists. A cliff's magnitude is stars lost, a
 * stall's is days silent, and a licence change has no magnitude at all — so the
 * same "magnitude" column across mixed rows is only honest if the reader is told
 * which unit each number is in. Rendering a bare number would invite comparing
 * 30000 stars against 300 days, which is not a comparison any of this data
 * supports.
 */
interface FlagStyle {
  icon: ComponentType<{
    size?: number
    className?: string
    "aria-hidden"?: boolean
  }>
  label: string
  unit: string
  /** `null` for kinds with no magnitude; rendered as an em dash, not as 0. */
  magnitude: (row: AnomalyWithRepo) => number | null
  accent: string
}

const FLAGS: Record<AnomalyKind, FlagStyle> = {
  star_cliff: {
    icon: IconArrowDownRight,
    label: "增速断崖",
    unit: "星",
    magnitude: (row) => row.magnitude,
    accent: "border-radar-down text-radar-down",
  },
  star_acceleration: {
    icon: IconTrendingUp,
    label: "异常加速",
    unit: "星",
    magnitude: (row) => row.magnitude,
    accent: "border-radar-up text-radar-up",
  },
  release_stall: {
    icon: IconPlayerSkipForward,
    label: "维护停滞",
    unit: "天",
    magnitude: (row) => row.magnitude,
    accent: "border-radar-down text-radar-down",
  },
  commit_stall: {
    icon: IconInfoCircle,
    label: "推送停滞",
    unit: "天",
    magnitude: (row) => row.magnitude,
    accent: "border-radar-down text-radar-down",
  },
  license_change: {
    // Its own icon rather than the generic triangle: a licence change is not a
    // maintenance signal, and grouping it under "warning" alongside a release
    // stall is how a reader ends up treating it as one.
    icon: IconLicense,
    label: "许可证变更",
    unit: "",
    magnitude: () => null,
    accent: "border-amber-500 text-amber-600 dark:text-amber-400",
  },
}

/**
 * Which icon marks the severity band.
 *
 * A lookup rather than a conditional: a component created during render is a
 * new component type on every pass, which React treats as a remount — and here
 * it would collapse the `<details>` a reader had expanded, every time the feed
 * re-rendered underneath them.
 */
const SEVERITY_ICONS: Record<
  AnomalySeverity,
  ComponentType<{
    size?: number
    className?: string
    "aria-hidden"?: boolean
  }>
> = {
  down: IconArrowDownRight,
  risk: IconAlertTriangle,
  notice: IconInfoCircle,
  good: IconTrendingUp,
}

function formatMagnitude(value: number | null, unit: string): string {
  if (value === null) return "—"
  const rounded = Math.round(value)
  return unit
    ? `${rounded.toLocaleString("en-US")} ${unit}`
    : rounded.toLocaleString("en-US")
}

export function AnomalyList({
  anomalies,
  emptyMessage = "现在没有检测到异动。",
}: {
  anomalies: AnomalyWithRepo[]
  emptyMessage?: string
}) {
  if (anomalies.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ul className="grid gap-2">
      {anomalies.map((row) => (
        <AnomalyRow key={row.id} row={row} />
      ))}
    </ul>
  )
}

function AnomalyRow({ row }: { row: AnomalyWithRepo }) {
  const flag = FLAGS[row.kind]
  const FlagIcon = flag.icon
  const SeverityIcon = SEVERITY_ICONS[row.severity as AnomalySeverity]

  return (
    <li className="grid gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <LocaleLink
          href={`/projects/${row.owner}/${row.name}`}
          className="font-medium hover:underline"
        >
          {row.owner}/{row.name}
        </LocaleLink>

        {row.stars !== null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.stars.toLocaleString("en-US")} ★
          </span>
        ) : null}

        <span
          className={`inline-flex items-center gap-1 rounded-md border border-l-2 px-1.5 py-0.5 text-xs font-medium ${flag.accent}`}
        >
          {/* Shape carries the meaning; the colour repeats it. */}
          <FlagIcon size={12} aria-hidden />
          {flag.label}
        </span>

        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatMagnitude(flag.magnitude(row), flag.unit)}
        </span>
      </div>

      <div className="flex items-start gap-1.5 text-sm">
        <SeverityIcon
          size={14}
          className="mt-0.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span>{row.title}</span>
      </div>

      {row.evidence?.series?.length ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            原始数据（{row.evidence.series.length} 期）
          </summary>
          <ul className="mt-1 grid gap-0.5">
            {row.evidence.series.map((point, index) => (
              <li
                key={`${point.label}-${index}`}
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

      {row.evidence?.notes?.length ? (
        <ul className="text-xs text-muted-foreground">
          {row.evidence.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * The "we report good news too" column (§5.4 red line 3).
 *
 * A feed that only ever says "this one is dying" cannot show that its alerts are
 * selective, and a reader who cannot tell those apart has to assume every row is
 * noise. `star_acceleration` rows live in the same table as the alerts precisely
 * so this can read from the same query.
 */
export function GoodNewsList({ anomalies }: { anomalies: AnomalyWithRepo[] }) {
  if (anomalies.length === 0) return null
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold">我们也会说：健康加速</h2>
      <ul className="grid gap-2">
        {anomalies.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-l-2 border-border border-radar-up bg-card px-3 py-2 text-sm"
          >
            <IconTrendingUp size={14} className="text-radar-up" aria-hidden />
            <span className="font-medium">
              {row.owner}/{row.name}
            </span>
            <span className="text-xs text-muted-foreground">异常加速</span>
            <span className="ml-auto text-xs font-semibold text-radar-up tabular-nums">
              +{Math.round(row.magnitude).toLocaleString("en-US")} 星
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
