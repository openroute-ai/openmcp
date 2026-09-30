import type { GitHubClient } from "@/lib/github/client"
import type { NpmClient } from "@/lib/npm/client"
import { createBufferingLogger } from "@/lib/tasks/runner"
import type { TRPCContext } from "@/lib/trpc/init"
import { ADMIN_ROLE } from "@/lib/auth/role"

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

/**
 * A tRPC context for a session with a role.
 *
 * Every procedure now reads the role off the session, so a caller built with
 * `{}` as its session is refused by `adminProcedure` and the suite fails with
 * FORBIDDEN rather than testing anything. Naming the role here means a test
 * states which audience it is acting as, instead of the role being an invisible
 * property of a cast.
 */
export function fakeTRPCContext(
  db: unknown,
  role: string | null,
  extra: Record<string, unknown> = {}
): TRPCContext {
  return {
    db: db as never,
    session: {
      id: "session-1",
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        emailVerified: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        role,
      },
    },
    headers: new Headers({ authorization: "Bearer test" }),
    ...extra,
  } as unknown as TRPCContext
}

/** A context for an operator, which is the audience `/dashboard` is for. */
export function fakeAdminContext(db: unknown, extra = {}) {
  return fakeTRPCContext(db, ADMIN_ROLE, extra)
}

/**
 * A context for a signed-in non-admin, the audience `/console` serves. Carries a
 * role that is deliberately not `admin`, so a test using it exercises the same
 * refusal a real ordinary account gets.
 */
export function fakeUserContext(db: unknown, extra = {}) {
  return fakeTRPCContext(db, "user", extra)
}

/** A context for nobody, which every procedure refuses. */
export function fakeAnonymousContext(db: unknown, extra = {}) {
  return {
    db: db as never,
    session: null,
    headers: new Headers(),
    ...extra,
  } as unknown as TRPCContext
}
