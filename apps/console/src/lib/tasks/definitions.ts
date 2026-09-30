/**
 * The tasks the scheduler can run, and their default schedules.
 *
 * Cron expressions are in Asia/Shanghai, matching the source app, so a
 * schedule that reads "3am" fires at the same wall-clock time the team
 * intended. Vercel Cron itself runs in UTC, so the entrypoint must convert
 * rather than pass the expression straight through.
 *
 * The expressions say *when a period is due*, not when the run happens. A
 * single daily wake-up stands in for all of them, so `04:00` is read as "the
 * 04:00 work is due from 04:00" and the run for that work may land later the
 * same day, or the next morning, depending on the wake-up. See
 * `@/lib/tasks/schedule` for the rule that turns an expression into the
 * period a run belongs to.
 */

export const SCHEDULE_TIMEZONE = "Asia/Shanghai"

export interface TaskSeed {
  name: string
  description: string
  /** In SCHEDULE_TIMEZONE. */
  cronExpression: string
  taskType: string
  isDaily?: boolean
  isWeekly?: boolean
  isMonthly?: boolean
  /** Tasks the Cron entrypoint runs on every tick, in order. */
  alwaysRun?: boolean
}

/**
 * The default definitions, matching the source scheduler.
 *
 * The ordering is the dependency order: repository data feeds the rankings,
 * and the rankings feed the notifications. A tick that runs them out of order
 * would notify on stale numbers.
 */
export const TASK_SEEDS: TaskSeed[] = [
  {
    name: "update-github-data",
    description: "Refresh repository data from GitHub",
    cronExpression: "0 2 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "update-package-data",
    description: "Refresh npm package metadata and monthly download counts",
    cronExpression: "30 2 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "update-bundle-size",
    description: "Re-measure browser bundle sizes for packages that changed",
    cronExpression: "0 4 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "snapshot-stars",
    description: "Sweep stargazer timestamps into monthly history",
    cronExpression: "0 5 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "build-daily-data",
    description: "Build the daily ranking snapshot",
    cronExpression: "0 6 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "notify-daily",
    description: "Publish the daily ranking notification",
    cronExpression: "0 7 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "build-weekly-rankings",
    description: "Build the weekly ranking snapshot",
    cronExpression: "0 8 * * 1",
    taskType: "weekly",
    isWeekly: true,
  },
  {
    name: "trigger-weekly-finished",
    description: "Publish the weekly ranking notification",
    cronExpression: "0 9 * * 1",
    taskType: "weekly",
    isWeekly: true,
  },
  {
    name: "build-monthly-rankings",
    description: "Build the monthly ranking snapshot",
    cronExpression: "0 3 1 * *",
    taskType: "monthly",
    isMonthly: true,
  },
  {
    name: "trigger-monthly-finished",
    description: "Publish the monthly ranking notification",
    cronExpression: "0 4 1 * *",
    taskType: "monthly",
    isMonthly: true,
  },
  {
    name: "sync-skill-repos",
    description: "Fetch and translate every skill project's SKILL.md files",
    cronExpression: "0 10 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "discover-skill-repos",
    description: "Search GitHub for new skill repositories to curate",
    cronExpression: "0 11 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "push-skills",
    description:
      "Push skills that have never been pushed, or whose last push failed",
    // Thirty minutes after the morning skill sync, on a minute Vercel wakes.
    cronExpression: "30 10 * * *",
    taskType: "daily",
    isDaily: true,
  },
  {
    name: "build-rising-stars",
    description: "Build the Rising Stars report for the previous year",
    // A yearly report: midday on the first day of the year, when the twelve
    // months before it are all on record. The task also runs manually with an
    // explicit year.
    cronExpression: "0 12 1 1 *",
    taskType: "yearly",
  },
  {
    name: "refresh-authors",
    description: "Refresh hall of fame authors from their GitHub profiles",
    // Weekly, and off the hour: a follower count does not move in a day, and
    // the sweep spends the same rate-limit budget the repository refreshes
    // need on the same tick.
    cronExpression: "0 4 * * 1",
    taskType: "weekly",
    isWeekly: true,
  },
]

/**
 * The order tasks must run in: the seed order.
 *
 * Repository data feeds the rankings and the rankings feed the notifications,
 * so the Cron cascade cannot use the alphabetical order the definitions come
 * back from the database in. Unknown names sort last, in name order, so a task
 * an operator added runs after the pipeline it depends on rather than in the
 * middle of it.
 */
export function seedRank(name: string): number {
  const index = TASK_SEEDS.findIndex((seed) => seed.name === name)
  return index === -1 ? TASK_SEEDS.length : index
}

export function sortBySeedOrder<T extends { name: string }>(
  definitions: readonly T[]
): T[] {
  return [...definitions].sort(
    (a, b) =>
      seedRank(a.name) - seedRank(b.name) || a.name.localeCompare(b.name)
  )
}

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
}

export type { CronFields }

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()

  for (const part of field.split(",")) {
    const slash = part.indexOf("/")
    const range = slash === -1 ? part : part.slice(0, slash)
    const stepText = slash === -1 ? undefined : part.slice(slash + 1)
    const step = stepText ? Number.parseInt(stepText, 10) : 1

    if (!Number.isFinite(step) || step < 1) {
      throw new Error(`Invalid cron step in "${part}"`)
    }

    let start: number
    let end: number

    if (range === "*") {
      start = min
      end = max
    } else if (range.includes("-")) {
      const dash = range.indexOf("-")
      start = Number.parseInt(range.slice(0, dash), 10)
      end = Number.parseInt(range.slice(dash + 1), 10)
    } else {
      start = Number.parseInt(range, 10)
      // A bare number with a step is a range from there to the end, which is
      // how "*/15" and "5/10" behave in standard cron.
      end = stepText ? max : start
    }

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Invalid cron field "${field}"`)
    }
    if (start < min || end > max || start > end) {
      throw new Error(`Cron field "${field}" is out of range ${min}-${max}`)
    }

    for (let value = start; value <= end; value += step) {
      values.add(value)
    }
  }

  return values
}

/** The five cron fields, or throws with the reason. */
export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(
      `Cron expression must have 5 fields, got ${fields.length}: "${expression}"`
    )
  }

  // The length check above guarantees five elements, which is what this cast
  // asserts; without it the array index reads as possibly-undefined.
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [
    string,
    string,
    string,
    string,
    string,
  ]

  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12),
    // 0 and 7 both mean Sunday.
    dayOfWeek: new Set(
      [...parseField(dayOfWeek, 0, 7)].map((day) => (day === 7 ? 0 : day))
    ),
  }
}

/**
 * Whether a cron expression matches a moment, in a named timezone.
 *
 * Day-of-month and day-of-week follow cron's OR rule: when both are
 * restricted, a date matching either one is due. That is long-standing cron
 * behaviour and the source schedules depend on it.
 */
export function matchesCron(
  expression: string,
  now: Date,
  timeZone: string
): boolean {
  const cron = parseCron(expression)
  const parts = zonedParts(now, timeZone)

  if (!cron.minute.has(parts.minute)) return false
  if (!cron.hour.has(parts.hour)) return false
  if (!cron.month.has(parts.month)) return false

  const dayOfMonthRestricted = cron.dayOfMonth.size !== 31
  const dayOfWeekRestricted = cron.dayOfWeek.size !== 7

  const dayOfMonthMatches = cron.dayOfMonth.has(parts.day)
  const dayOfWeekMatches = cron.dayOfWeek.has(parts.dayOfWeek)

  // Either field alone is a plain match; both restricted means OR.
  if (dayOfMonthRestricted && dayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches
  }
  if (dayOfMonthRestricted) return dayOfMonthMatches
  if (dayOfWeekRestricted) return dayOfWeekMatches
  return true
}

/** Wall-clock fields for a moment in a timezone. */
export function zonedParts(
  now: Date,
  timeZone: string
): {
  year: number
  minute: number
  hour: number
  second: number
  day: number
  month: number
  dayOfWeek: number
} {
  // en-US with a UTC timezone is the reliable way to read local fields
  // without depending on the server's own locale or zone.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") parts[part.type] = part.value
  }

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  const weekday = parts.weekday

  return {
    // Intl renders midnight as "24" in some locales under hour12: false, so
    // it is reduced back into 0-23.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    year: Number(parts.year),
    day: Number(parts.day),
    month: Number(parts.month),
    dayOfWeek: weekday === undefined ? 0 : (weekdays[weekday] ?? 0),
  }
}
