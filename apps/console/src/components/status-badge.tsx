import { Badge } from "@workspace/ui/components/badge"
import { IconLoader } from "@tabler/icons-react"

const taskStatusClass: Record<string, string> = {
  completed: "border-emerald-400/40 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/40 text-destructive",
  running: "border-sky-400/40 text-sky-700 dark:text-sky-300",
  pending: "border-muted-foreground/30 text-muted-foreground",
  cancelled: "border-muted-foreground/30 text-muted-foreground",
}

const syncStatusClass: Record<string, string> = {
  success: "border-emerald-400/40 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/40 text-destructive",
  running: "border-sky-400/40 text-sky-700 dark:text-sky-300",
  pending: "border-muted-foreground/30 text-muted-foreground",
}

function RunningIcon() {
  return <IconLoader className="animate-spin" />
}

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={taskStatusClass[status] ?? undefined}>
      {status === "running" && <RunningIcon />}
      {status}
    </Badge>
  )
}

export function SyncStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={syncStatusClass[status] ?? undefined}>
      {status === "running" && <RunningIcon />}
      {status}
    </Badge>
  )
}
