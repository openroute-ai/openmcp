/**
 * The concrete task implementations.
 *
 * Built lazily because several of them construct a GitHub client on creation,
 * and that client requires a token. Importing this module must not fail on a
 * page that only wants to read task history.
 */

import { createBuildDailyDataTask } from "@/lib/tasks/tasks/build-daily-data"
import { createBuildRankingsTask } from "@/lib/tasks/tasks/build-rankings"
import { createDiscoverSkillReposTask } from "@/lib/tasks/tasks/discover-skill-repos"
import { createNotifyDailyTask } from "@/lib/tasks/tasks/notify-daily"
import { createSnapshotStarsTask } from "@/lib/tasks/tasks/snapshot-stars"
import { createSyncSkillReposTask } from "@/lib/tasks/tasks/sync-skill-repos"
import { createTriggerRankingsFinishedTask } from "@/lib/tasks/tasks/trigger-ranking-finished"
import { createUpdateGitHubDataTask } from "@/lib/tasks/tasks/update-github-data"
import { createUpdateBundleSizeTask } from "@/lib/tasks/tasks/update-bundle-size"
import { createUpdatePackageDataTask } from "@/lib/tasks/tasks/update-package-data"
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
    createBuildRankingsTask("week"),
    createBuildRankingsTask("month"),
    createNotifyDailyTask(),
    createTriggerRankingsFinishedTask("week"),
    createTriggerRankingsFinishedTask("month"),
    createSyncSkillReposTask(),
    createDiscoverSkillReposTask(),
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
