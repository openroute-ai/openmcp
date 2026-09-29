import emojiRegex from "emoji-regex"

/**
 * Repository fields requested from the GitHub GraphQL API.
 *
 * Shared by the single-repository and batched queries so both return the
 * same shape and the extractor only has to understand one format.
 */
const REPOSITORY_FIELDS = /* GraphQL */ `
  name
  description
  homepageUrl
  createdAt
  pushedAt
  updatedAt
  isArchived
  forkCount
  owner {
    login
    avatarUrl
  }
  licenseInfo {
    spdxId
  }
  languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
    nodes {
      name
    }
  }
  openGraphImageUrl
  usesCustomOpenGraphImage
  defaultBranchRef {
    name
    target {
      ... on Commit {
        history(first: 1) {
          totalCount
          edges {
            node {
              ... on Commit {
                committedDate
              }
            }
          }
        }
      }
    }
  }
`

/**
 * Connections that a fine-grained token may not be able to read. Star,
 * watcher and mentionable-user connections in particular raise FORBIDDEN
 * when the token lacks the "Metadata" or public-repo permission, which is
 * why the client falls back to a reduced query and backfills from REST.
 */
const COUNTED_FIELDS = /* GraphQL */ `
  stargazers {
    totalCount
  }
  mentionableUsers {
    totalCount
  }
  watchers {
    totalCount
  }
  pullRequests {
    totalCount
  }
  releases {
    totalCount
  }
  repositoryTopics(last: 20) {
    totalCount
    edges {
      node {
        topic {
          name
        }
      }
    }
  }
  latestRelease {
    name
    tagName
    publishedAt
    url
    description
  }
`

export const queryRepoInfo = /* GraphQL */ `
  query getRepoInfo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ${REPOSITORY_FIELDS}
      ${COUNTED_FIELDS}
    }
  }
`

/**
 * Reduced query used when the token cannot read some of the counted
 * connections. Keeps only fields that are served to any valid token; the
 * client backfills the omitted counts from the REST API.
 */
export const queryRepoInfoBasic = /* GraphQL */ `
  query getRepoInfo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ${REPOSITORY_FIELDS}
    }
  }
`

/** Fields that never need backfilling, for the REST fallback query. */
export const queryRepoInfoMinimal = /* GraphQL */ `
  query getRepoInfo($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      description
      homepageUrl
      owner {
        login
        avatarUrl
      }
    }
  }
`

/**
 * Builds one query that fetches many repositories at once.
 *
 * The source app issued one GraphQL request per repository, so a full
 * refresh of 500 repositories cost 500 of the 5,000 points/hour a token
 * gets. GitHub's node cost is driven by the number of fields requested,
 * not the number of top-level selections, so aliasing the same query
 * under different keys collapses that to a handful of requests.
 *
 * Aliases are indexed (`r0`, `r1`, ...) because a GraphQL name may only
 * contain letters, digits and underscores, and may not start with a digit.
 */
export function buildBatchRepoInfoQuery(count: number): string {
  if (count < 1) {
    throw new Error("buildBatchRepoInfoQuery requires at least one repository")
  }
  if (count > MAX_BATCH_SIZE) {
    throw new Error(
      `batch size ${count} exceeds the maximum of ${MAX_BATCH_SIZE}`
    )
  }

  const variables = Array.from(
    { length: count },
    (_, i) => `$owner${i}: String!, $name${i}: String!`
  ).join(", ")
  const selections = Array.from(
    { length: count },
    (_, i) => `r${i}: repository(owner: $owner${i}, name: $name${i}) {
      ${REPOSITORY_FIELDS}
      ${COUNTED_FIELDS}
    }`
  ).join("\n      ")

  return `query getRepoInfoBatch(${variables}) {\n      ${selections}\n    }`
}

/**
 * Upper bound on repositories per batched request. GitHub caps a single
 * query at 500,000 nodes; the fields above cost roughly 1 point each, so
 * this stays far below the ceiling while keeping request sizes sane.
 */
export const MAX_BATCH_SIZE = 100

export type BatchVariables = Record<string, string>

/** Slices a list of repositories into batches the API will accept. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be positive")
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

// --- response extraction ---------------------------------------------------

function safeGet<T>(obj: unknown, path: string[], defaultValue: T): T {
  let current: unknown = obj
  for (const key of path) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return defaultValue
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current !== null && current !== undefined
    ? (current as T)
    : defaultValue
}

function safeGetArray(
  obj: unknown,
  path: string[],
  defaultValue: unknown[] = []
) {
  const result = safeGet<unknown>(obj, path, null)
  return Array.isArray(result) ? result : defaultValue
}

function safeGetDate(
  obj: unknown,
  path: string[],
  defaultValue = new Date()
): Date {
  const value = safeGet<unknown>(obj, path, null)
  if (typeof value !== "string" && typeof value !== "number")
    return defaultValue
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? defaultValue : date
}

export type RepoInfo = {
  name: string
  fullName: string
  owner: string
  ownerId: number
  description: string
  homepage: string
  createdAt: Date
  pushedAt: Date
  defaultBranch: string
  stars: number
  topics: string[]
  archived: boolean
  commitCount: number
  lastCommit: Date
  mentionableUsersCount: number
  watchersCount: number
  licenseSpdxId: string
  pullRequestsCount: number
  releasesCount: number
  languages: string[]
  forks: number
  openGraphImageUrl: string
  usesCustomOpenGraphImage: boolean
  latestReleaseName: string
  latestReleaseTagName: string
  latestReleasePublishedAt: Date | undefined
  latestReleaseUrl: string
  latestReleaseDescription: string
}

/**
 * Turns a GraphQL `repository` node into a flat record.
 *
 * The counts are optional because the reduced query omits them and the
 * client backfills from REST afterwards.
 */
export function extractRepoInfo(response: unknown): RepoInfo {
  const repository = safeGet<unknown>(response, ["repository"], null)
  if (!repository) {
    throw new Error("Repository data not found in response")
  }

  const owner = safeGet<{ login?: string; avatarUrl?: string }>(
    repository,
    ["owner"],
    {}
  )
  const name = safeGet<string>(repository, ["name"], "")
  const login = owner.login ?? ""

  const licenseInfo = safeGet<{ spdxId?: string | null } | null>(
    repository,
    ["licenseInfo"],
    null
  )
  const latestRelease = safeGet<Record<string, unknown> | null>(
    repository,
    ["latestRelease"],
    null
  )
  const defaultBranchRef = safeGet<Record<string, unknown> | null>(
    repository,
    ["defaultBranchRef"],
    null
  )
  const commitHistory = safeGet<Record<string, unknown>>(
    defaultBranchRef,
    ["target", "history"],
    { totalCount: 0, edges: [] }
  )
  const commitEdges = safeGetArray(commitHistory, ["edges"])

  const topicEdges = safeGetArray(repository, ["repositoryTopics", "edges"])
  const languageNodes = safeGetArray(repository, ["languages", "nodes"])

  const releasePublishedAt = safeGet<unknown>(
    latestRelease,
    ["publishedAt"],
    undefined
  )

  return {
    name,
    fullName: `${login}/${name}`,
    owner: login,
    ownerId: extractOwnerIdFromAvatarUrl(owner.avatarUrl ?? ""),
    description: cleanGitHubDescription(
      safeGet<string | null>(repository, ["description"], "")
    ),
    homepage: safeGet<string | null>(repository, ["homepageUrl"], "") ?? "",
    createdAt: safeGetDate(repository, ["createdAt"]),
    pushedAt: safeGetDate(repository, ["pushedAt"]),
    defaultBranch:
      safeGet<string | null>(defaultBranchRef, ["name"], null) ?? "main",
    stars: safeGet<number>(repository, ["stargazers", "totalCount"], 0),
    topics: topicEdges
      .map((edge) => getTopic(edge))
      .filter((topic): topic is string => Boolean(topic)),
    archived: safeGet<boolean>(repository, ["isArchived"], false),
    commitCount: safeGet<number>(commitHistory, ["totalCount"], 0),
    lastCommit:
      commitEdges.length > 0
        ? safeGetDate(commitEdges[0], ["node", "committedDate"])
        : new Date(),
    mentionableUsersCount: safeGet<number>(
      repository,
      ["mentionableUsers", "totalCount"],
      0
    ),
    watchersCount: safeGet<number>(repository, ["watchers", "totalCount"], 0),
    licenseSpdxId: licenseInfo?.spdxId ?? "",
    pullRequestsCount: safeGet<number>(
      repository,
      ["pullRequests", "totalCount"],
      0
    ),
    releasesCount: safeGet<number>(repository, ["releases", "totalCount"], 0),
    languages: languageNodes
      .map((node) => safeGet<string>(node, ["name"], ""))
      .filter((language): language is string => Boolean(language)),
    forks: safeGet<number>(repository, ["forkCount"], 0),
    openGraphImageUrl:
      safeGet<string | null>(repository, ["openGraphImageUrl"], "") ?? "",
    usesCustomOpenGraphImage: safeGet<boolean>(
      repository,
      ["usesCustomOpenGraphImage"],
      false
    ),
    latestReleaseName:
      safeGet<string | null>(latestRelease, ["name"], null) ?? "",
    latestReleaseTagName:
      safeGet<string | null>(latestRelease, ["tagName"], null) ?? "",
    latestReleasePublishedAt:
      releasePublishedAt === undefined
        ? undefined
        : safeGetDate(latestRelease, ["publishedAt"]),
    latestReleaseUrl:
      safeGet<string | null>(latestRelease, ["url"], null) ?? "",
    latestReleaseDescription:
      safeGet<string | null>(latestRelease, ["description"], null) ?? "",
  }
}

function getTopic(edge: unknown): string | undefined {
  const node = safeGet<unknown>(edge, ["node"], null)
  if (!node) return undefined
  return safeGet<string | null>(node, ["topic", "name"], null) ?? undefined
}

/**
 * GitHub's GraphQL API does not return the numeric user id directly, but
 * every avatar URL contains it: `https://avatars.githubusercontent.com/u/1?v=4`.
 */
function extractOwnerIdFromAvatarUrl(url: string): number {
  if (!url) return 0
  const match = /\/u\/(\d+)/.exec(url)
  return match?.[1] ? Number(match[1]) : 0
}

/**
 * Descriptions arrive with `:emoji:` shortcodes and unicode emoji, both of
 * which show up as mojibake in the ranking feeds this data feeds.
 *
 * Removing the emoji characters leaves the spaces that surrounded them, so
 * whitespace is collapsed afterwards: without it the same description
 * normalises two different ways depending on whether it had an emoji, which
 * breaks both display and equality comparisons against stored copies.
 */
function cleanGitHubDescription(description: string | null | undefined) {
  if (!description) return ""
  const withoutShortcodes = description.replace(/(:([a-z_\d]+):)/gi, "")
  const withoutEmoji = withoutShortcodes
    .replace(emojiRegex(), "")
    // Strip the variation selector GitHub appends around emoji.
    .replace(new RegExp(String.fromCharCode(65039), "g"), "")
  return withoutEmoji.replace(/\s+/g, " ").trim()
}
