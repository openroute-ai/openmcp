import type { GitHubClient } from "@/lib/github/client"
import type { NpmClient } from "@/lib/npm/client"
import { createBufferingLogger } from "@/lib/tasks/runner"

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : DeepPartial<T[K]>
}

/**
 * A GitHub client stub whose methods are vi.fn, so a test overrides only the
 * ones it cares about and the rest throw rather than silently returning
 * undefined. A silent undefined is how a task under test ends up asserting
 * against a value that never came from the API.
 */
export function fakeGitHubClient(
  overrides: DeepPartial<GitHubClient> = {}
): GitHubClient {
  const unimplemented = (name: string) => () => {
    throw new Error(`fake GitHub client: ${name} was not stubbed`)
  }

  const base = {
    fetchRepoInfo: unimplemented("fetchRepoInfo"),
    fetchRepos: unimplemented("fetchRepos"),
    fetchContributorCount: unimplemented("fetchContributorCount"),
    fetchRepoReadMeAsMarkdown: unimplemented("fetchRepoReadMeAsMarkdown"),
    fetchStargazersWithTimestamps: unimplemented(
      "fetchStargazersWithTimestamps"
    ),
    fetchFileContent: unimplemented("fetchFileContent"),
    listDirectory: unimplemented("listDirectory"),
    searchRepositories: unimplemented("searchRepositories"),
    fetchUserInfo: unimplemented("fetchUserInfo"),
    listUserRepositories: unimplemented("listUserRepositories"),
    fetchRepoReadMeAsHtml: unimplemented("fetchRepoReadMeAsHtml"),
  }

  return { ...base, ...overrides } as unknown as GitHubClient
}

export function fakeNpmClient(overrides: Partial<NpmClient> = {}): NpmClient {
  const unimplemented = (name: string) => () => {
    throw new Error(`fake npm client: ${name} was not stubbed`)
  }

  return {
    fetchPackageInfo: unimplemented("fetchPackageInfo"),
    fetchMonthlyDownloadCount: unimplemented("fetchMonthlyDownloadCount"),
    fetchBundleData: unimplemented("fetchBundleData"),
    ...overrides,
  }
}

/** A task context with a logger that keeps its text for assertions. */
export function fakeContext(db: unknown, extra: Record<string, unknown> = {}) {
  return {
    db: db as never,
    definition: { id: "def-1", name: "test" } as never,
    execution: { id: "exec-1" } as never,
    logger: createBufferingLogger(),
    ...extra,
  }
}
