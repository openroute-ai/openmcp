/**
 * The wire form of `RepoInfo`.
 *
 * The ingest endpoint receives repository data as JSON, so the dates arrive as
 * ISO strings rather than `Date`s, and `latestReleasePublishedAt` is absent
 * for a repository that has never released. It lives next to the type it
 * describes so a field added to `RepoInfo` cannot be quietly forgotten by the
 * endpoint that receives it.
 */

import { z } from "zod"
import type { ProjectType } from "@/db/schema"
import type { RepoInfo } from "@/lib/github/repo-info-query"

/** The project types ingest may ask a URL-form request to create. */
const PROJECT_INGEST_TYPES = [
  "application",
  "skill",
  "client",
  "server",
  "persona",
] as const satisfies readonly ProjectType[]

/**
 * An ISO 8601 timestamp, as JSON carries it.
 *
 * `z.coerce.date()` is not used because it accepts `null` (as the epoch) and
 * a numeric string, both of which would silently store a wrong date.
 */
const timestamp = z.iso.datetime().transform((value) => new Date(value))

export const repoInfoSchema = z
  .object({
    name: z.string().min(1),
    fullName: z.string().min(1),
    owner: z.string().min(1),
    ownerId: z.number().int(),
    description: z.string().default(""),
    homepage: z.string().default(""),
    createdAt: timestamp,
    pushedAt: timestamp,
    defaultBranch: z.string().default(""),
    stars: z.number().int().nonnegative().default(0),
    topics: z.array(z.string()).default([]),
    archived: z.boolean().default(false),
    commitCount: z.number().int().nonnegative().default(0),
    lastCommit: timestamp,
    mentionableUsersCount: z.number().int().nonnegative().default(0),
    watchersCount: z.number().int().nonnegative().default(0),
    licenseSpdxId: z.string().default(""),
    pullRequestsCount: z.number().int().nonnegative().default(0),
    openIssuesCount: z.number().int().nonnegative().default(0),
    releasesCount: z.number().int().nonnegative().default(0),
    languages: z.array(z.string()).default([]),
    forks: z.number().int().nonnegative().default(0),
    openGraphImageUrl: z.string().default(""),
    usesCustomOpenGraphImage: z.boolean().default(false),
    latestReleaseName: z.string().default(""),
    latestReleaseTagName: z.string().default(""),
    latestReleasePublishedAt: timestamp
      .nullish()
      .transform((value) => value ?? undefined),
    latestReleaseUrl: z.string().default(""),
    latestReleaseDescription: z.string().default(""),
  })
  .strict()

/**
 * The URL form of the ingest body.
 *
 * A caller that does not hold GitHub data asks this app to fetch it by naming
 * the repository instead. `owner` and `name` are accepted but ignored: the URL
 * is authoritative, and a caller that used to send all three should keep
 * working rather than be rejected for a redundant field. `type` chooses the
 * project classification, and defaults to `skill` because the only caller that
 * needs the fetch is registering a skill repository.
 */
export const repoUrlIngestSchema = z.object({
  url: z.string().min(1).max(500),
  owner: z.string().optional(),
  name: z.string().optional(),
  type: z.enum(PROJECT_INGEST_TYPES).optional(),
})

export type RepoUrlIngest = z.infer<typeof repoUrlIngestSchema>

/**
 * Parses an ingest body as either a full `RepoInfo` or a repository URL.
 *
 * The two forms are discriminated by shape rather than by a tag, so an
 * existing caller that posts a `RepoInfo` is untouched. A body that parses as
 * neither reports the `RepoInfo` issue: it is the stricter of the two, so its
 * message names the field a collector actually got wrong, whereas "url:
 * required" would be misleading for an object that was clearly meant to be a
 * `RepoInfo`.
 */
export type RepoIngest =
  | { kind: "info"; info: RepoInfo }
  | { kind: "url"; url: string; type: ProjectType }

export function parseRepoIngest(
  body: unknown
): { ok: true; ingest: RepoIngest } | { ok: false; message: string } {
  const info = repoInfoSchema.safeParse(body)
  if (info.success) {
    return { ok: true, ingest: { kind: "info", info: info.data } }
  }

  const url = repoUrlIngestSchema.safeParse(body)
  if (url.success) {
    return {
      ok: true,
      ingest: { kind: "url", url: url.data.url, type: url.data.type ?? "skill" },
    }
  }

  const issue = info.error.issues[0]
  const path = issue?.path.join(".") || "(body)"
  return {
    ok: false,
    message: issue ? `${path}: ${issue.message}` : "invalid body",
  }
}

/**
 * Parses a request body into the `RepoInfo` the service layer expects.
 *
 * A single message is returned rather than the issue list because the caller
 * is a machine: it logs the response, and a path plus a reason is what tells
 * it which field to fix.
 */
export function parseRepoInfo(
  body: unknown
): { ok: true; info: RepoInfo } | { ok: false; message: string } {
  const parsed = repoInfoSchema.safeParse(body)

  if (parsed.success) {
    return { ok: true, info: parsed.data }
  }

  const issue = parsed.error.issues[0]
  const path = issue?.path.join(".") || "(body)"
  return {
    ok: false,
    message: issue ? `${path}: ${issue.message}` : "invalid body",
  }
}
