/**
 * The outbound repo-data webhook payload.
 *
 * The consumer of these callbacks stores the baker's dozen of fields below
 * under its own names, so the shape is a contract: the payload keys are kept
 * exactly as the source app sent them, snake_case included, even though the
 * rows they are built from use camelCase here.
 */

import type { ProjectType } from "@/db/schema"

/** The columns of a repo that the callback carries. */
export interface RepoWebhookSource {
  id: string
  name: string
  owner: string
  ownerId: number | null
  description: string | null
  descriptionZh: string | null
  homepage: string | null
  stars: number | null
  forks: number | null
  contributorCount: number | null
  mentionableUsersCount: number | null
  watchersCount: number | null
  pullRequestsCount: number | null
  releasesCount: number | null
  commitCount: number | null
  topics: unknown
  languages: unknown
  licenseSpdxId: string | null
  defaultBranch: string | null
  createdAt: Date | null
  pushedAt: Date | null
  lastCommit: Date | null
  addedAt: Date
  updatedAt: Date | null
  archived: boolean | null
  iconUrl: string | null
  openGraphImageUrl: string | null
  openGraphImageOssUrl: string | null
  usesCustomOpenGraphImage: boolean | null
  readmeContent: string | null
  readmeContentZh: string | null
  latestReleaseName: string | null
  latestReleaseTagName: string | null
  latestReleasePublishedAt: Date | null
  latestReleaseUrl: string | null
  latestReleaseDescription: string | null
  latestReleaseDescriptionZh: string | null
}

export interface RepoWebhookStats {
  icon_processed: boolean
  description_translated: boolean
  readme_translated: boolean
  og_image_processed: boolean
  release_note_translated: boolean
}

export interface RepoWebhookMeta {
  task_name: string
  processed_at: string
  processing_time_ms: number
  success: boolean
  error_message?: string
}

export interface RepoWebhookAuthor {
  name?: string | null
  username?: string | null
  avatar?: string | null
  avatar_url?: string | null
  description?: string | null
  bio?: string | null
  website?: string | null
  twitter?: string | null
  linkedin?: string | null
  github?: string | null
  verified?: boolean | null
  status?: string | null
  metadata?: unknown
}

export interface RepoWebhookRequest {
  event_type: "repo_updated"
  timestamp: string
  data: Record<string, unknown>
}

/** Renders a date field as an ISO string, or undefined when it was null. */
function iso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined
}

/**
 * Builds the callback body from a repository row.
 *
 * `author` is optional because the daily push carries none: the author is the
 * repository owner, who the openmcp consumer copies into its authors table,
 * and the daily callback has no reason to refresh owners it already has.
 */
export function createRepoWebhookRequest(
  type: ProjectType,
  repo: RepoWebhookSource,
  processingStatus: RepoWebhookStats,
  meta: RepoWebhookMeta,
  author?: RepoWebhookAuthor
): RepoWebhookRequest {
  const fullName = `${repo.owner}/${repo.name}`

  return {
    event_type: "repo_updated",
    timestamp: new Date().toISOString(),
    data: {
      type,
      id: repo.id,
      full_name: fullName,
      name: repo.name,
      owner: repo.owner,
      owner_id: repo.ownerId,

      description: repo.description,
      description_zh: repo.descriptionZh,
      homepage: repo.homepage,

      stars: repo.stars,
      forks: repo.forks,
      contributor_count: repo.contributorCount,
      mentionable_users_count: repo.mentionableUsersCount,
      watchers_count: repo.watchersCount,
      pull_requests_count: repo.pullRequestsCount,
      releases_count: repo.releasesCount,
      commit_count: repo.commitCount,

      topics: repo.topics,
      languages: repo.languages,
      license_spdx_id: repo.licenseSpdxId,
      default_branch: repo.defaultBranch,

      created_at: iso(repo.createdAt),
      pushed_at: iso(repo.pushedAt),
      last_commit: iso(repo.lastCommit),
      added_at: iso(repo.addedAt),
      updated_at: iso(repo.updatedAt),

      archived: repo.archived,

      icon_url: repo.iconUrl,
      open_graph_image_url: repo.openGraphImageUrl,
      open_graph_image_oss_url: repo.openGraphImageOssUrl,
      uses_custom_open_graph_image: repo.usesCustomOpenGraphImage,

      readme_content: repo.readmeContent,
      readme_content_zh: repo.readmeContentZh,

      latest_release_name: repo.latestReleaseName,
      latest_release_tag_name: repo.latestReleaseTagName,
      latest_release_published_at: iso(repo.latestReleasePublishedAt),
      latest_release_url: repo.latestReleaseUrl,
      latest_release_description: repo.latestReleaseDescription,
      latest_release_description_zh: repo.latestReleaseDescriptionZh,

      processing_status: processingStatus,
      meta,
      ...(author != null && { author }),
    },
  }
}
