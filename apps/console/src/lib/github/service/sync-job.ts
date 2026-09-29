/**
 * Sync job bookkeeping.
 *
 * A job row is the audit trail of one repository or project sync: what was
 * attempted, what triggered it, and how it ended. The rows are written as the
 * work runs rather than derived afterwards, because a job that failed and was
 * never retried is exactly the row an operator needs to find.
 *
 * Nothing in this module performs the sync itself; it only records it.
 */

import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { projectSyncJobs, readmeSyncJobs } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

export type SyncTrigger =
  "project_create" | "manual" | "system" | "retry" | "task"

/** How a job ended, so callers cannot record a failure with no message. */
export type SyncOutcome = { ok: true } | { ok: false; error: string }

export interface CreateProjectSyncJobInput {
  projectId: string
  repoId: string
  triggeredBy: string
  /**
   * Recorded for the audit trail only. Nothing delivers to it yet: the column
   * exists so a job that was requested against a delivery target can be
   * recognised, not so a caller can assume a webhook was sent.
   */
  webhookUrl?: string | null
}

/**
 * Records a project sync that is about to run.
 *
 * Created as `running` rather than `pending` because the caller holds the row
 * while it works: a job that is only queued and never picked up would sit at
 * `pending` forever and read as outstanding work that nothing owns.
 */
export async function startProjectSyncJob(
  db: Db,
  input: CreateProjectSyncJobInput
): Promise<string> {
  const id = nanoid()
  const [row] = await db
    .insert(projectSyncJobs)
    .values({
      id,
      projectId: input.projectId,
      repoId: input.repoId,
      status: "running",
      triggeredBy: input.triggeredBy,
      webhookUrl: input.webhookUrl ?? null,
      startedAt: new Date(),
    })
    .returning({ id: projectSyncJobs.id })

  return row?.id ?? id
}

/** The readme equivalent of {@link startProjectSyncJob}. */
export async function startReadmeSyncJob(
  db: Db,
  input: { repoId: string; triggeredBy: string }
): Promise<string> {
  const id = nanoid()
  const [row] = await db
    .insert(readmeSyncJobs)
    .values({
      id,
      repoId: input.repoId,
      status: "running",
      triggeredBy: input.triggeredBy,
      startedAt: new Date(),
    })
    .returning({ id: readmeSyncJobs.id })

  return row?.id ?? id
}

/**
 * Closes a project sync job.
 *
 * `completedAt` is the outcome's timestamp rather than "now", so a retry that
 * reports when the work actually finished stays sortable against the job it
 * retried.
 */
export async function finishProjectSyncJob(
  db: Db,
  id: string,
  outcome: SyncOutcome,
  at = new Date()
): Promise<void> {
  await db
    .update(projectSyncJobs)
    .set(
      outcome.ok
        ? { status: "success", completedAt: at, errorMessage: null }
        : { status: "failed", completedAt: at, errorMessage: outcome.error }
    )
    .where(eq(projectSyncJobs.id, id))
}

/** The readme equivalent of {@link finishProjectSyncJob}. */
export async function finishReadmeSyncJob(
  db: Db,
  id: string,
  outcome: SyncOutcome,
  at = new Date()
): Promise<void> {
  await db
    .update(readmeSyncJobs)
    .set(
      outcome.ok
        ? { status: "success", completedAt: at, errorMessage: null }
        : { status: "failed", completedAt: at, errorMessage: outcome.error }
    )
    .where(eq(readmeSyncJobs.id, id))
}
