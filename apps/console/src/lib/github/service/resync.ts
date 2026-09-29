/**
 * Starting a project resync.
 *
 * Lives outside the router because two different pages start the same work:
 * the project page resyncs one project, and the sync log retries a failed job.
 * Both need the same in-flight lock and the same job bookkeeping, and a lock
 * that each caller owned separately would let the two pages start the same
 * project twice while each believed it was the only one running.
 */

import { after } from "next/server"
import { eq, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { getProjectById } from "@/lib/github/service/project"
import {
  finishProjectSyncJob,
  startProjectSyncJob,
  type SyncOutcome,
  type SyncTrigger,
} from "@/lib/github/service/sync-job"
import { syncProjectData } from "@/lib/github/sync-project"
import { createBufferingLogger, type TaskLogger } from "@/lib/tasks/runner"
import type { Db } from "@/lib/github/service/repo"
import { projectSyncJobs } from "@/db/schema"

/**
 * Project ids with a resync in flight in this instance.
 *
 * Process-local, like the task runner's own lock: it stops one operator from
 * starting a second run by double-clicking, and it cannot see a run started by
 * another instance. A row left at `running` by a killed process is reclaimed
 * the same way the task runner reclaims stale executions.
 */
const runningSyncs = new Set<string>()

/** Whether a resync is in flight for a project, for disabling the button. */
export function isResyncing(projectId: string): boolean {
  return runningSyncs.has(projectId)
}

/**
 * Starts a resync and returns as soon as the job row exists.
 *
 * The work outlives the request: a full refresh is a metadata request, a
 * contributor count, a README fetch, an asset upload, a star snapshot and up
 * to three language-model calls. The job row is the record of the attempt
 * whether it succeeded or not, so the caller can poll it and return.
 */
export async function startProjectResync(
  db: Db,
  input: { projectId: string; triggeredBy: SyncTrigger }
): Promise<{ jobId: string }> {
  const project = await getProjectById(db, input.projectId)
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" })
  }
  if (!project.repo) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `project ${input.projectId} has no repository`,
    })
  }

  // Refused rather than queued: two concurrent runs would race on the same
  // README, the same asset uploads and the same snapshot month, and the
  // slower one would win with the older data.
  if (runningSyncs.has(input.projectId)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "a resync is already running for this project",
    })
  }

  const jobId = await startProjectSyncJob(db, {
    projectId: project.id,
    repoId: project.repoId,
    triggeredBy: input.triggeredBy,
  })

  runningSyncs.add(input.projectId)
  const work = runProjectSync(db, input.projectId, jobId).finally(() =>
    runningSyncs.delete(input.projectId)
  )

  runAfterResponse(work)

  return { jobId }
}

/**
 * Retries a failed job by starting a new one and counting the attempt on the
 * original row.
 *
 * The original row is left as it ended rather than reopened: `retryCount` and
 * the new row together are the history, and rewriting a `failed` row to
 * `running` would erase the failure the operator is trying to get past.
 */
export async function retryProjectSyncJob(
  db: Db,
  jobId: string
): Promise<{ jobId: string }> {
  const [job] = await db
    .select({
      id: projectSyncJobs.id,
      projectId: projectSyncJobs.projectId,
      status: projectSyncJobs.status,
    })
    .from(projectSyncJobs)
    .where(eq(projectSyncJobs.id, jobId))
  if (!job) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Sync job not found" })
  }
  if (job.status !== "failed") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "only a failed job can be retried",
    })
  }

  const started = await startProjectResync(db, {
    projectId: job.projectId,
    triggeredBy: "retry",
  })

  await db
    .update(projectSyncJobs)
    .set({
      retryCount: sql`${projectSyncJobs.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(projectSyncJobs.id, jobId))

  return started
}

async function runProjectSync(
  db: Db,
  projectId: string,
  jobId: string
): Promise<void> {
  const logger: TaskLogger = createBufferingLogger()
  let outcome: SyncOutcome
  try {
    const result = await syncProjectData(db, projectId, { logger })
    for (const warning of result.warnings) logger.warn(warning)
    // A run that stored what it could and left warnings is still a success:
    // the job records whether the pipeline completed, and a repository with no
    // README is not a pipeline that failed.
    outcome = { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error("project resync failed", error)
    outcome = { ok: false, error: message }
  }
  await finishProjectSyncJob(db, jobId, outcome)
}

/**
 * Keeps a background promise alive past the response.
 *
 * `after` hands the work to the platform's clock, which is what a multi-minute
 * resync needs: a bare floating promise can be frozen the moment the handler
 * returns, and a resync killed halfway would leave its job at `running` for
 * ever. It throws outside a request scope, so the fallback is a floating
 * promise — the same behaviour the source app relied on, and still better than
 * awaiting, which would outlive the request anyway.
 */
function runAfterResponse(work: Promise<void>): void {
  const report = async () => {
    try {
      await work
    } catch (error) {
      console.error("[resync] project resync failed", error)
    }
  }

  try {
    after(report)
  } catch {
    void report()
  }
}
