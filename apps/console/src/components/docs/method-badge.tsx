import { cn } from "@workspace/ui/lib/utils"

/**
 * 侧栏条目上的方法徽标。
 *
 * 颜色只用来扫读——GET 是读、POST 是写，两组端点在侧栏里一眼能分开；
 * 不熟悉的颜色不承担语义，方法名始终是可读的文字。
 */
const METHOD_COLORS: Record<string, string> = {
  GET: "border-emerald-600/40 text-emerald-600 dark:text-emerald-400",
  POST: "border-sky-600/40 text-sky-600 dark:text-sky-400",
  PUT: "border-amber-600/40 text-amber-600 dark:text-amber-400",
  PATCH: "border-amber-600/40 text-amber-600 dark:text-amber-400",
  DELETE: "border-red-600/40 text-red-600 dark:text-red-400",
}

export function MethodBadge({
  method,
  className,
}: {
  method: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1 py-px font-mono text-[10px] font-semibold leading-4",
        METHOD_COLORS[method] ?? "border-border text-muted-foreground",
        className,
      )}
    >
      {method}
    </span>
  )
}
