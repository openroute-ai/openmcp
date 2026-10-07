/**
 * The concrete task implementations.
 *
 * Built lazily because several of them construct a GitHub client on creation,
 * and that client requires a token. Importing this module must not fail on a
 * page that only wants to read task history.
 */

import { createBuildDailyDataTask } from "@/lib/tasks/tasks/build-daily-data"
import { createBuildRankingsTask } from "@/lib/tasks/tasks/build-rankings"
import { createBuildRisingStarsTask } from "@/lib/tasks/tasks/build-rising-stars"
import { createClassifyProjectsTask } from "@/lib/tasks/tasks/classify-projects"
import { createDetectAnomaliesTask } from "@/lib/tasks/tasks/detect-anomalies"
import { createDiscoverSkillReposTask } from "@/lib/tasks/tasks/discover-skill-repos"
import { createNotifyDailyTask } from "@/lib/tasks/tasks/notify-daily"
import { createNotifySubscriptionsTask } from "@/lib/tasks/tasks/notify-subscriptions"
import { createPushSkillsTask } from "@/lib/tasks/tasks/push-skills"
import { createRefreshAuthorsTask } from "@/lib/tasks/tasks/refresh-authors"
import { createSnapshotStarsTask } from "@/lib/tasks/tasks/snapshot-stars"
import { createSyncSkillReposTask } from "@/lib/tasks/tasks/sync-skill-repos"
import { createUpdateGitHubDataTask } from "@/lib/tasks/tasks/update-github-data"
import { createUpdateBundleSizeTask } from "@/lib/tasks/tasks/update-bundle-size"
import { createUpdatePackageDataTask } from "@/lib/tasks/tasks/update-package-data"
import { createCleanupSkillScanTmpTask } from "@/lib/tasks/tasks/cleanup-skill-scan-tmp"
import { getTaskRegistry, setTaskRegistry, type Task } from "@/lib/tasks/runner"

/**
 * Task names that are defined and scheduled but have no implementation yet.
 *
 * Every seeded task is implemented; the set is kept because the scheduler,
 * CLI and tests read it, and it is now empty. The next scheduled task that
 * cannot yet be built in this repository goes in here instead of shipping as
 * code that fails at runtime.
 */
export const UNIMPLEMENTED_TASKS = new Set<string>([])

let installed = false

/**
 * Installs the real implementations into the runner's registry.
 *
 * Idempotent, because a serverless instance is reused across requests and the
 * registry is module state. Rebuilding it per request would allocate a fresh
 * GitHub client each time.
 */
export function installTaskRegistry(): Map<string, Task> {
  if (installed) return getTaskRegistry()

  const tasks: Task[] = [
    createUpdateGitHubDataTask(),
    createUpdatePackageDataTask(),
    createUpdateBundleSizeTask(),
    createSnapshotStarsTask(),
    createBuildDailyDataTask(),
    createDetectAnomaliesTask(),
    createClassifyProjectsTask(),
    createBuildRankingsTask("week"),
    createBuildRankingsTask("month"),
    createNotifyDailyTask(),
    // 订阅投递排在两个排行任务之后：`TASK_SEEDS` 的顺序即依赖顺序，而需求要求
    // 「排行全部落库之后再推」，否则接收方拿到的是缺周期的榜单（设计文档 §6.3）。
    // 周/月榜摘要不再由独立任务推送：`repos.rankings` 订阅携带同一份
    // `buildRankingsFor*` 的结果，周期由 `cadence` 决定（§6.3）。
    createNotifySubscriptionsTask(),
    createSyncSkillReposTask(),
    createDiscoverSkillReposTask(),
    createBuildRisingStarsTask(),
    createPushSkillsTask(),
    createRefreshAuthorsTask(),
    createCleanupSkillScanTmpTask(),
  ]

  const registry = new Map(tasks.map((task) => [task.name, task]))
  setTaskRegistry(registry)
  installed = true
  return registry
}

/** Test seam: forgets that the registry was installed. */
export function resetInstalledTasks(): void {
  setTaskRegistry(undefined)
  installed = false
}
