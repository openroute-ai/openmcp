/**
 * The vitals strip: one row of current readings, no score.
 *
 * §3 replaced "六维评分 92/100" with this, and the reason it is a strip and not a
 * score is the point rather than a visual preference: every reading here can be
 * challenged on its own, and a single number cannot be. There is no `healthScore`
 * prop and adding one would make the strip a score with extra steps.
 *
 * A missing reading renders as a dash, not as zero. "Not measured" and "measured
 * zero" are different facts and collapsing them is how a project that we have
 * simply not synced yet ends up looking like a project in decline.
 *
 * The factor reads as "3.0x" rather than "+200%": a ratio of 2 to 8 is both 4x
 * and +300%, and the percentage form makes a small-base week look like the
 * quarter's headline. See `vitals.ts`'s `starFactor`.
 */

import {
  IconCalendarDue,
  IconGitCommit,
  IconLicense,
  IconStar,
} from "@tabler/icons-react"
import type { ComponentType } from "react"

import type { Vital, VitalSnapshot } from "@/lib/radar/vitals"

/**
 * One reading's presentation.
 *
 * `good` is about the polarity of the colour, not about how good the news is:
 * a rising star factor is red here (§5.9.2) and a project that has not pushed in
 * 200 days is green. Getting this backwards is the single most likely way for a
 * reader from any other site to misread this page.
 */
interface Reading {
  label: string
  value: (vital: VitalSnapshot) => string
  Icon: ComponentType<{
    size?: number
    className?: string
    "aria-hidden"?: boolean
  }>
  tone: (vital: Vital) => string
}

const NEUTRAL = "text-foreground"
const MUTED = "text-muted-foreground"

const READINGS: Reading[] = [
  {
    label: "本周新增",
    value: (v) =>
      v.starsThisWeek === undefined
        ? "—"
        : `${v.starsThisWeek.toLocaleString("en-US")} 星`,
    Icon: IconStar,
    tone: (v) =>
      v.starsThisWeek === undefined
        ? MUTED
        : v.starsThisWeek > 0
          ? "text-radar-up"
          : "text-radar-down",
  },
  {
    // Named with its window rather than as a bare multiplier: "4.0x" on its own
    // answers no question, and this is the reading most likely to be misread as
    // a score.
    label: "近 3 周倍数",
    value: (v) =>
      v.starFactor === undefined ? "—" : `${v.starFactor.toFixed(1)}x`,
    Icon: IconStar,
    tone: (v) =>
      v.direction === "up"
        ? "text-radar-up"
        : v.direction === "down"
          ? "text-radar-down"
          : MUTED,
  },
  {
    label: "距上次推送",
    value: (v) =>
      v.daysSincePush === undefined ? "—" : `${v.daysSincePush} 天`,
    Icon: IconGitCommit,
    tone: () => NEUTRAL,
  },
  {
    label: "距上次发布",
    value: (v) =>
      v.daysSinceRelease === undefined ? "—" : `${v.daysSinceRelease} 天`,
    Icon: IconCalendarDue,
    tone: () => NEUTRAL,
  },
  {
    label: "许可证",
    value: (v) => v.license ?? "—",
    Icon: IconLicense,
    tone: () => NEUTRAL,
  },
]

export function VitalsStrip({ vital }: { vital: Vital }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-5">
      {READINGS.map(({ label, value, Icon, tone }) => (
        <div
          key={label}
          className="grid min-h-[56px] content-center gap-0.5 bg-background px-3 py-2.5"
        >
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon size={12} aria-hidden />
            {label}
          </dt>
          <dd className={`text-sm font-medium tabular-nums ${tone(vital)}`}>
            {value(vital)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
