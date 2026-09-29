import { format, formatDistanceToNowStrict } from "date-fns"
import prettyMs from "pretty-ms"

export function formatRelative(value: Date | null | undefined): string {
  if (!value) return "—"
  return `${formatDistanceToNowStrict(value, { addSuffix: true })}`
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—"
  return format(value, "MMM d, HH:mm")
}

export function formatDuration(value: number | null | undefined): string {
  if (value == null) return "—"
  return prettyMs(value)
}

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}
