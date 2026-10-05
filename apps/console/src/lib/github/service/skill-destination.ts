/**
 * Where one project's skill documents are delivered.
 *
 * The destination is per project and comes from the submitting caller: there is
 * no deployment-wide skills endpoint any more, so a console serves however many
 * submitters each name their own address on `POST /api/v1/projects`. It lives
 * on the project row rather than in the environment because delivery outlives
 * the request that asked for it — the inline push is the fast path, and the
 * `push-skills` retry queue and the operator's "retry now" button both run
 * later with nothing to read an address from.
 *
 * Two outcomes are kept distinct because they mean opposite things to a caller
 * answering "can I use this skill yet?": a project with no destination is a
 * deployment or submission fact and must not be reported as a failed push,
 * whereas a destination that refuses the delivery is a failure worth retrying.
 */
import { eq } from "drizzle-orm"
import { projects } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"

/**
 * A delivery target, or `null` when the project has none.
 *
 * The secret is required alongside the URL rather than defaulted: signing with a
 * shared key would let any caller impersonate every other one of them, and
 * delivering unsigned would let anyone who learns the URL inject skills. A
 * half-configured pair is stored as nothing at all — see {@link recordSkillsDestination}.
 */
export interface SkillsDestination {
  url: string
  secret: string
}

/**
 * Reads a project's delivery target.
 *
 * Returns `null` when the project does not exist or was published without a
 * callback, which are the same thing to every caller here: there is nowhere to
 * deliver to.
 */
export async function getSkillsDestination(
  db: Db,
  projectId: string
): Promise<SkillsDestination | null> {
  const [row] = await db
    .select({
      url: projects.skillsWebhookUrl,
      secret: projects.skillsWebhookSecret,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!row?.url || !row.secret) return null
  return { url: row.url, secret: row.secret }
}

/**
 * Records where a project's skills should go.
 *
 * A no-op when the caller gave no callback, which is the idempotent case: a
 * repository that was published once with a destination keeps it, so a later
 * submission without one neither loses the address the retry queue depends on
 * nor silently re-points delivery.
 *
 * A URL without a secret is rejected upstream rather than stored as a partial
 * pair, so this only ever sees both or neither. An existing destination is
 * replaced: re-submitting the same repository with a different address is how
 * a submitter moves a project between environments.
 */
export async function recordSkillsDestination(
  db: Db,
  projectId: string,
  destination?: { url: string; secret: string }
): Promise<void> {
  if (!destination) return

  await db
    .update(projects)
    .set({
      skillsWebhookUrl: destination.url,
      skillsWebhookSecret: destination.secret,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
}