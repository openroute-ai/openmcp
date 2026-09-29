/**
 * Finds repositories worth curating, and records them as candidates.
 *
 * Discovery does not publish. A search result is stored as a repository with
 * no project attached, which means it is visible in the admin listing and
 * absent from the public site until someone curates it. The source app
 * auto-created projects from search results, which meant a repository that
 * merely matched a topic became a published entry.
 *
 * The query set is split by frequency: the core and OpenClaw queries run every
 * cycle, the extended set weekly. Search has a much lower rate limit than the
 * rest of the API, so running all 37 queries daily spends the budget on
 * queries that mostly return the same results.
 */

import { createGitHubClient, type GitHubClient } from "@/lib/github/client"
import {
  CORE_QUERIES,
  EXTENDED_QUERIES,
  OPENCLAW_QUERIES,
  SKILL_MARKERS,
} from "@/lib/github/search-queries"
import { getRepoByFullName, upsertRepo } from "@/lib/github/service/repo"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"

/** GitHub's search API allows 10 requests per minute. */
const SEARCH_THROTTLE_MS = 6_200

/**
 * Below this, a repository is not curated.
 *
 * The search itself already filters on stars for most queries, but not all, and
 * a one-star repository matching a topic is noise rather than a candidate.
 */
const MIN_STARS = 5

export interface DiscoverOptions {
  /** Runs the weekly query set as well as the daily one. */
  weekly?: boolean
  minStars?: number
  perPage?: number
}

export function createDiscoverSkillReposTask(
  client: GitHubClient = createGitHubClient(),
  options: DiscoverOptions = {}
): Task {
  return {
    name: "discover-skill-repos",
    description:
      "Search GitHub for skill and MCP repositories and store any that are " +
      "not already known, as uncurated candidates",

    async run({ db, logger }) {
      const queries = [
        ...CORE_QUERIES,
        ...OPENCLAW_QUERIES,
        ...(options.weekly ? EXTENDED_QUERIES : []),
      ]
      logger.info(`running ${queries.length} discovery quer(y/ies)`)

      const minStars = options.minStars ?? MIN_STARS
      const found = new Map<string, { description: string; stars: number }>()

      for (const query of queries) {
        try {
          const results = await client.searchRepositories(query, {
            perPage: options.perPage ?? 30,
            sort: "stars",
          })

          for (const result of results) {
            // A malformed result would otherwise be stored as a repository
            // with an empty name, which no listing can render.
            if (!result.fullName.includes("/")) continue
            if (result.stars < minStars) continue

            // Kept only if it looks like the thing being searched for. The
            // queries match on topics as well as name, so a high-ranked
            // unrelated repository can appear.
            if (!looksLikeSkill(result.fullName, result.description)) continue

            const existing = found.get(result.fullName)
            // Highest star count wins, so a repository found by several
            // queries is not demoted by whichever query ran last.
            if (!existing || result.stars > existing.stars) {
              found.set(result.fullName, {
                description: result.description,
                stars: result.stars,
              })
            }
          }
        } catch (error) {
          // One failed query must not abandon the others: the extended set is
          // 21 of the 37, and losing it to one rate-limit response would make
          // the weekly run a partial run every time.
          logger.error(`discovery query failed: ${query}`, error)
        }

        await waitForSearchSlot()
      }

      const result = await processItems(
        [...found.keys()],
        async (fullName) => {
          const known = await getRepoByFullName(db, fullName)
          if (known) {
            // Already stored. Recorded so the summary says how much of the
            // result set was genuinely new.
            return { meta: { known: 1 }, data: null }
          }

          const info = await client.fetchRepoInfo(fullName)
          await upsertRepo(db, info)

          // A candidate is a repository and nothing more. The project row is
          // what publishes it, and creating one here would publish every
          // search result.
          logger.info(`discovered ${fullName} (${info.stars} stars), awaiting curation`)

          return { meta: { discovered: 1 }, data: null }
        },
        { logger, label: "candidate", concurrency: 2, throttleIntervalMs: 500 }
      )

      return {
        queries: queries.length,
        candidates: found.size,
        discovered: result.meta.discovered ?? 0,
        known: result.meta.known ?? 0,
        errors: result.meta.error ?? 0,
      }
    },
  }
}

/**
 * Whether a search hit is plausibly a skill, MCP or agent package.
 *
 * Checked against the name and description because that is all the search
 * result carries, and used only to filter noise out of a curated candidate
 * list. It is not a classifier, and nothing is published from it.
 */
export function looksLikeSkill(fullName: string, description: string): boolean {
  const haystack = `${fullName} ${description}`.toLowerCase()
  return SKILL_MARKERS.some((marker) => haystack.includes(marker))
}

function waitForSearchSlot(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SEARCH_THROTTLE_MS))
}
