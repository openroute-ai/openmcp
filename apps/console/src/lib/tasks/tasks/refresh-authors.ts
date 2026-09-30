/**
 * Fills in the author profiles behind the hall of fame.
 *
 * An author row is created from a repository, which knows the GitHub login and
 * nothing else, so the display fields an author card shows — a name that is not
 * the handle, a bio, a follower count, a Twitter handle — were never written by
 * anything. This is the task that writes them.
 *
 * It is a task rather than a step of `update-github-data` for two reasons: a
 * profile is a byline and must not be able to fail the repository refresh it
 * happens alongside, and the two have different cadences. A repository changes
 * on its author's schedule; a profile's follower count goes stale slowly and
 * needs no more often than a sweep of everyone.
 *
 * Every author is refreshed, not only the incomplete ones. A follower count
 * that was right at publication is wrong a year later, and "only fetch what is
 * missing" would mean it is right exactly once.
 */

import {
  listAuthors,
  refreshAuthorProfile,
} from "@/lib/github/service/hall-of-fame"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"
import type { GitHubClient } from "@/lib/github/client"

export interface RefreshAuthorsOptions {
  client?: Pick<GitHubClient, "fetchUserInfo">
  /** Skips a refresh for an author updated within this many hours. */
  freshWithinHours?: number
}

export function createRefreshAuthorsTask(
  options: RefreshAuthorsOptions = {}
): Task {
  return {
    name: "refresh-authors",
    description: "Refresh every hall of fame author from their GitHub profile",

    async run({ db, logger }) {
      const authors = await listAuthors(db)
      if (authors.length === 0) {
        logger.info("no authors to refresh")
        return { processed: 0, refreshed: 0, failed: 0 }
      }

      const cutoff =
        options.freshWithinHours === undefined
          ? null
          : Date.now() - options.freshWithinHours * 3_600_000
      const stale =
        cutoff === null
          ? authors
          : authors.filter(
              (author) =>
                author.updatedAt === null || author.updatedAt.getTime() < cutoff
            )

      if (stale.length === 0) {
        logger.info(`all ${authors.length} authors refreshed recently`)
        return {
          processed: 0,
          refreshed: 0,
          failed: 0,
          skipped: authors.length,
        }
      }

      // Serial rather than concurrent: these are GraphQL calls against one
      // rate-limit budget, and a burst of them is the fastest way to exhaust
      // it and leave the repository tasks unable to run.
      const results = await processItems(
        stale,
        async (author) => {
          const result = await refreshAuthorProfile(db, author.username, {
            client: options.client,
          })
          if (result.ok) {
            logger.info(
              result.avatarMirrored
                ? `refreshed ${author.username} and mirrored their avatar`
                : `refreshed ${author.username}`
            )
          } else {
            logger.error(
              `failed ${author.username}: ${result.error} — kept the stored profile`
            )
          }
          return {
            meta: {
              processed: 1,
              refreshed: result.ok ? 1 : 0,
              mirrored: result.ok && result.avatarMirrored ? 1 : 0,
            },
            data: { username: author.username, ok: result.ok },
          }
        },
        { logger, label: "author", concurrency: 1 }
      )

      return {
        processed: results.meta.processed ?? 0,
        refreshed: results.meta.refreshed ?? 0,
        mirrored: results.meta.mirrored ?? 0,
        failed: (results.meta.processed ?? 0) - (results.meta.refreshed ?? 0),
        skipped: authors.length - stale.length,
      }
    },
  }
}
