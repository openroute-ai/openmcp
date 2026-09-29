/**
 * Unit tests for the outbound repo-data webhook payload.
 *
 * The payload is a consumer contract, so the mapping details are asserted
 * directly: a renamed key upstream would otherwise arrive at the consumer
 * under no key at all.
 */
import { describe, expect, it } from "vitest"
import {
  createRepoWebhookRequest,
  type RepoWebhookSource,
} from "@/lib/webhook/repo-webhook"

const PROCESSING = {
  icon_processed: false,
  description_translated: false,
  readme_translated: false,
  og_image_processed: false,
  release_note_translated: false,
}

const META = {
  task_name: "update-github-data",
  processed_at: "2026-03-01T00:00:00.000Z",
  processing_time_ms: 12,
  success: true,
}

function source(overrides: Partial<RepoWebhookSource> = {}): RepoWebhookSource {
  return {
    id: "repo-1",
    name: "repo",
    owner: "owner",
    ownerId: 100,
    description: "A repository",
    descriptionZh: "一个仓库",
    homepage: "https://example.com",
    stars: 120,
    forks: 10,
    contributorCount: 5,
    mentionableUsersCount: 7,
    watchersCount: 60,
    pullRequestsCount: 3,
    releasesCount: 2,
    commitCount: 40,
    topics: ["typescript"],
    languages: ["TypeScript"],
    licenseSpdxId: "MIT",
    defaultBranch: "main",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    pushedAt: new Date("2026-02-15T00:00:00Z"),
    lastCommit: new Date("2026-02-14T00:00:00Z"),
    addedAt: new Date("2024-01-02T00:00:00Z"),
    updatedAt: new Date("2026-02-15T00:00:00Z"),
    archived: false,
    iconUrl: "https://cdn.example.com/icon.png",
    openGraphImageUrl: "https://images.example.com/og.png",
    openGraphImageOssUrl: "https://oss.example.com/og.png",
    usesCustomOpenGraphImage: true,
    readmeContent: "# repo",
    readmeContentZh: "# 仓库",
    latestReleaseName: "v1",
    latestReleaseTagName: "v1.0.0",
    latestReleasePublishedAt: new Date("2026-02-01T00:00:00Z"),
    latestReleaseUrl: "https://github.com/owner/repo/releases/v1.0.0",
    latestReleaseDescription: "First release",
    latestReleaseDescriptionZh: "首个版本",
    ...overrides,
  }
}

describe("createRepoWebhookRequest", () => {
  it("sends the source's event envelope", () => {
    const request = createRepoWebhookRequest(
      "application",
      source(),
      PROCESSING,
      META
    )

    expect(request.event_type).toBe("repo_updated")
    expect(request.timestamp).toEqual(expect.any(String))
    expect(request.data.full_name).toBe("owner/repo")
    expect(request.data.type).toBe("application")
  })

  it("maps camelCase storage to the snake_case consumer keys", () => {
    const data = createRepoWebhookRequest(
      "application",
      source(),
      PROCESSING,
      META
    ).data

    expect(data.owner_id).toBe(100)
    expect(data.contributor_count).toBe(5)
    expect(data.mentionable_users_count).toBe(7)
    expect(data.open_graph_image_url).toBe("https://images.example.com/og.png")
    expect(data.uses_custom_open_graph_image).toBe(true)
    expect(data.latest_release_published_at).toBe("2026-02-01T00:00:00.000Z")
    expect(data.default_branch).toBe("main")
  })

  it("renders null dates as undefined rather than an error or a null", () => {
    const data = createRepoWebhookRequest(
      "application",
      source({
        lastCommit: null,
        latestReleasePublishedAt: null,
        updatedAt: null,
      }),
      PROCESSING,
      META
    ).data

    expect(data.last_commit).toBeUndefined()
    expect(data.latest_release_published_at).toBeUndefined()
    expect(data.updated_at).toBeUndefined()
  })

  it("omits the author when none is provided", () => {
    const data = createRepoWebhookRequest(
      "application",
      source(),
      PROCESSING,
      META
    ).data
    expect("author" in data).toBe(false)
  })

  it("includes the author when provided", () => {
    const data = createRepoWebhookRequest(
      "application",
      source(),
      PROCESSING,
      META,
      {
        name: "One",
        username: "owner",
        avatar: "https://oss.example.com/a.png",
      }
    ).data

    expect(data.author).toEqual({
      name: "One",
      username: "owner",
      avatar: "https://oss.example.com/a.png",
    })
  })

  it("carries the meta and processing status verbatim", () => {
    const data = createRepoWebhookRequest(
      "application",
      source(),
      PROCESSING,
      META
    ).data

    expect(data.meta).toEqual(META)
    expect(data.processing_status).toEqual(PROCESSING)
  })
})
