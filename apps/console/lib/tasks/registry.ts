/**
 * The concrete task implementations.
 *
 * Built lazily because several of them construct a GitHub client on creation,
 * and that client requires a token. Importing this module must not fail on a
 * page that only wants to read task history.
 */

import { createBuildRankingsTask } from "@/lib/tasks/tasks/build-rankings"
import { createDiscoverSkillReposTask } from "@/lib/tasks/tasks/discover-skill-repos"
import { createSnapshotStarsTask } from "@/lib/tasks/tasks/snapshot-stars"
import { createSyncSkillReposTask } from "@/lib/tasks/tasks/sync-skill-repos"
import { createUpdateGitHubDataTask } from "@/lib/tasks/tasks/update-github-data"
import { createUpdateBundleSizeTask } from "@/lib/tasks/tasks/update-bundle-size"
import { createUpdatePackageDataTask } from "@/lib/tasks/tasks/update-package-data"
import { getTaskRegistry, setTaskRegistry, type Task } from "@/lib/tasks/runner"

/**
 * Task names that are defined and scheduled but have no implementation yet.
 *
 * The notification and build-trigger tasks post to services that are not part
 * of this migration. Naming them explicitly means the scheduler reports "not
 * implemented" rather than raising, so a due task shows up as a known gap
 * instead of an error that looks like a bug.
 */
export const UNIMPLEMENTED_TASKS = new Set([
  "build-daily-data",
  "notify-daily",
  "trigger-weekly-finished",
  "trigger-monthly-finished",
])

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
    createBuildRankingsTask("week"),
    createBuildRankingsTask("month"),
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
