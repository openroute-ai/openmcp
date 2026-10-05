import { requireGitHubToken } from "@/lib/env"
import { processReadMeHtml } from "./process-readme-html"
import { processReadMeMd } from "./process-readme-md"
import {
  buildBatchRepoInfoQuery,
  extractRepoInfo,
  MAX_BATCH_SIZE,
  queryRepoInfo,
  queryRepoInfoBasic,
  type BatchVariables,
  type RepoInfo,
} from "./repo-info-query"
import { extractUserInfo, queryUserInfo } from "./user-info-query"
import {
  type GraphQLErrorDetail,
  GitHubForbiddenError,
  GitHubGraphQLError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTransportError,
  graphqlErrorMessage,
  graphqlErrorType,
  toGitHubError,
} from "./errors"

const GITHUB_API = "https://api.github.com"
const GITHUB_GRAPHQL = "https://api.github.com/graphql"

/** Warn below this many remaining requests, then again at these levels. */
const RATE_LIMIT_WARN_THRESHOLDS = [1000, 500, 100, 10, 0]

/**
 * GitHub's own page size for star history, which it clamps to 30 whatever a
 * larger `per_page` asks for. Asking for 100 and getting 30 would make the loop
 * in `fetchStarHistory` stop early on a full page, so the constant is the value
 * that actually comes back.
 */
const HISTORY_PAGE_SIZE = 30

/**
 * How many history pages to request by default.
 *
 * `page` is capped at 100, so 30 weeks per page reaches about seven years. Most
 * repositories are younger than that and the request after the end returns
 * nothing, which is what ends the loop.
 */
const HISTORY_MAX_PAGES = 100

/** One week of star history, as GitHub reports it. */
export interface StarHistoryEntry {
  /** Unix seconds for the start of the week, which falls on a Sunday. */
  week: number
  /** Cumulative star count at the end of the week. */
  total: number
  /**
   * Seven daily counts, Monday first.
   *
   * Indexed from the day *after* `week`, so a Sunday-based bucket's array begins
   * on Monday and ends on the Sunday that opens the next bucket. Callers shift it
   * rather than assuming the two align.
   */
  days: number[]
}

/**
 * Normalises one history row.
 *
 * `total` and `days` are numbers on the wire and arrays of numbers respectively;
 * everything is checked rather than cast, because a bucket that arrived
 * malformed should drop that week instead of contributing a NaN that poisons a
 * cumulative sum for every week after it.
 */
function parseStarHistoryEntry(raw: unknown): StarHistoryEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const entry = raw as { week?: unknown; total?: unknown; days?: unknown }

  if (typeof entry.week !== "number" || !Number.isFinite(entry.week)) {
    return undefined
  }
  if (typeof entry.total !== "number" || !Number.isFinite(entry.total)) {
    return undefined
  }
  if (!Array.isArray(entry.days)) return undefined

  return {
    week: entry.week,
    total: entry.total,
    days: entry.days.map((day) =>
      typeof day === "number" && Number.isFinite(day) ? day : 0
    ),
  }
}

export interface ContentEntry {
  name: string
  path: string
  type: string
}

/**
 * One row of a Contents API response.
 *
 * A file carries `content`/`encoding` and a directory carries neither, which is
 * how the two are told apart. Every field is optional because the shape is
 * whatever GitHub chose to inline for the requested size.
 */
interface ContentsEntry {
  name?: string
  path?: string
  type?: string
  content?: string
  encoding?: string
}

/**
 * What one path in a repository turned out to be.
 *
 * A discriminated union rather than two methods, because the Contents API makes
 * this distinction in the same response that carries the content: an array means
 * a directory, an object means a file. Anything that has to know which it is
 * gets the answer without a second request and without inferring it from a name.
 */
export type PathContent =
  | { kind: "file"; content: string }
  | { kind: "directory"; entries: ContentEntry[] }

type ReposBatchResult = {
  /** Keyed by the input `owner/name`, so callers need not track indices. */
  results: Map<string, RepoInfo>
  /** Repositories GitHub could not resolve, keyed the same way. */
  missing: string[]
}

/**
 * REST + GraphQL client for GitHub.
 *
 * The three-tier fallback on `fetchRepoInfo` is the load-bearing part, and
 * is carried over from the source app:
 *
 * 1. the full GraphQL query, which returns every count in one request;
 * 2. on `NOT_FOUND`, a REST lookup to resolve the repository's current
 *    name (projects get renamed and moved) and a retry against that;
 * 3. on `FORBIDDEN`, a reduced query without the connections a fine-grained
 *    token may not read, with the omitted counts backfilled from REST.
 *
 * What changed:
 *
 * - Every failure is a typed error instead of a string match, and a rate
 *   limit is always rethrown rather than absorbed, so a throttled run backs
 *   off instead of retrying until the budget is gone.
 * - GraphQL goes over plain `fetch` so the real status and rate-limit
 *   headers survive; `graphql-request` discards them.
 * - Rate-limit budget is tracked and reported at thresholds.
 * - Contributor counts come from the REST API instead of a CSS-selector
 *   HTML scrape, which broke whenever GitHub changed its markup.
 * - `fetchRepos` batches up to 100 repositories per GraphQL request instead
 *   of issuing one request per repository.
 */
export function createGitHubClient() {
  const accessToken = requireGitHubToken()

  // --- rate limit bookkeeping ---------------------------------------------

  let lastReportedRemaining: number | undefined

  function trackRateLimit(headers: Headers) {
    const remaining = headers.get("x-ratelimit-remaining")
    if (remaining === null) return
    const value = Number(remaining)
    if (!Number.isFinite(value)) return

    if (
      lastReportedRemaining === undefined ||
      RATE_LIMIT_WARN_THRESHOLDS.some(
        (threshold) =>
          value <= threshold && threshold <= (lastReportedRemaining ?? Infinity)
      )
    ) {
      const reset = headers.get("x-ratelimit-reset")
      console.warn(
        `[github] rate limit: ${value} requests remaining` +
          (reset
            ? `, resets at ${new Date(Number(reset) * 1000).toISOString()}`
            : "")
      )
      lastReportedRemaining = value
    }
  }

  // --- REST ----------------------------------------------------------------

  async function makeRestApiRequest(
    endpoint: string,
    accept = "application/vnd.github.v3+json"
  ): Promise<Response> {
    const response = await fetch(`${GITHUB_API}/${endpoint}`, {
      headers: { accept, authorization: `token ${accessToken}` },
    })
    trackRateLimit(response.headers)
    return response
  }

  async function makeRestApiRequestJson(endpoint: string): Promise<unknown> {
    const response = await makeRestApiRequest(endpoint)
    if (!response.ok) {
      throw toGitHubError(
        new Error(`GitHub REST ${endpoint} failed: ${response.statusText}`),
        { status: response.status, headers: response.headers }
      )
    }
    return response.json()
  }

  // --- GraphQL -------------------------------------------------------------

  /**
   * Issues a GraphQL request over plain `fetch` rather than through
   * `graphql-request`.
   *
   * That library was the source app's choice, but it hides the two things
   * this client needs: it parses the body into `error.response` and drops
   * the HTTP headers, so a primary rate limit (HTTP 403 with
   * `x-ratelimit-remaining: 0`) becomes indistinguishable from a genuine
   * `FORBIDDEN` and the fallback chain responds by issuing *more* requests
   * while already throttled. Raw `fetch` keeps the real status, the real
   * rate-limit headers, and the `errors[].type` discriminator.
   */
  async function requestGraphQL<T>(
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(GITHUB_GRAPHQL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `bearer ${accessToken}`,
        },
        body: JSON.stringify({ query, variables }),
      })
    } catch (error) {
      throw new GitHubTransportError("GitHub GraphQL request failed", {
        cause: error,
      })
    }

    trackRateLimit(response.headers)

    if (!response.ok) {
      throw toGitHubError(
        new Error(`GitHub GraphQL returned ${response.status}`),
        { status: response.status, headers: response.headers }
      )
    }

    const body = (await response.json()) as {
      data?: T
      errors?: GraphQLErrorDetail[]
    }

    // GitHub answers 200 with an `errors` array when a field failed but the
    // rest of the selection resolved. This is the NOT_FOUND / FORBIDDEN case
    // the fallback chain routes on, so it must not be flattened into a
    // generic transport failure.
    if (body.errors && body.errors.length > 0) {
      throw new GitHubGraphQLError(body.errors)
    }

    if (body.data === undefined || body.data === null) {
      throw new GitHubTransportError(
        "GitHub GraphQL response contained no data"
      )
    }

    return body.data
  }

  // --- repository info -----------------------------------------------------

  async function fetchRepoInfoMain(
    fullName: string,
    query = queryRepoInfo
  ): Promise<RepoInfo> {
    const [owner, name] = fullName.split("/")
    if (!owner || !name) {
      throw new GitHubNotFoundError(`malformed repository name: ${fullName}`)
    }

    const response = await requestGraphQL<unknown>(query, { owner, name })
    return extractRepoInfo(response)
  }

  /**
   * Backfills the counts the reduced query omits. REST serves repository
   * metadata to any valid token, so this recovers stars, watchers, forks
   * and topics even when GraphQL connections are out of reach.
   */
  async function backfillRepoStats(
    repoInfo: RepoInfo,
    fullName: string
  ): Promise<RepoInfo> {
    const backfilled: RepoInfo = { ...repoInfo }

    try {
      const rest = (await makeRestApiRequestJson(
        `repos/${fullName}`
      )) as Record<string, unknown>
      if (Number.isInteger(rest.stargazers_count)) {
        backfilled.stars = rest.stargazers_count as number
      }
      if (Number.isInteger(rest.subscribers_count)) {
        backfilled.watchersCount = rest.subscribers_count as number
      }
      if (Number.isInteger(rest.forks_count)) {
        backfilled.forks = rest.forks_count as number
      }
      // `open_issues_count` is deliberately not used here. GitHub counts pull
      // requests inside it, so backfilling from it would turn a repository with
      // three open issues and nine open pull requests into "twelve open issues",
      // and the two are tracked as separate counters. It stays at whatever the
      // reduced query produced, which is zero, and readers treat a zero as
      // "not measured" for this one counter rather than as a finding.
    } catch (error) {
      // Topics are a separate endpoint, so a failure here must not discard
      // the counts already recovered above.
      if (error instanceof GitHubRateLimitError) throw error
      console.warn(`[github] could not backfill counts for ${fullName}`, error)
    }

    try {
      const topics = (await makeRestApiRequestJson(
        `repos/${fullName}/topics`
      )) as { names?: unknown }
      if (Array.isArray(topics?.names)) {
        backfilled.topics = topics.names.filter(
          (name): name is string => typeof name === "string"
        )
      }
    } catch (error) {
      if (error instanceof GitHubRateLimitError) throw error
      console.warn(`[github] could not backfill topics for ${fullName}`, error)
    }

    return backfilled
  }

  /**
   * Resolves a repository that GraphQL could not find to its current
   * `owner/name`. GitHub redirects renamed and transferred repositories on
   * REST, so the response is followed to its final URL.
   */
  async function fetchRepoInfoFallback(fullName: string): Promise<RepoInfo> {
    const response = await makeRestApiRequest(`repos/${fullName}`)

    if (response.status === 404) {
      throw new GitHubNotFoundError(fullName)
    }
    if (!response.ok) {
      throw toGitHubError(
        new Error(`GitHub REST lookup failed: ${response.statusText}`),
        { status: response.status, headers: response.headers }
      )
    }

    const finalUrl = new URL(response.url)
    const segments = finalUrl.pathname.replace(/^\//, "").split("/")
    const [owner, name] = segments
    if (!owner || !name) {
      throw new GitHubTransportError(
        `Could not determine current location of ${fullName}`
      )
    }

    return {
      name,
      fullName: `${owner}/${name}`,
      owner,
      ownerId: 0,
      description: "",
      homepage: "",
      createdAt: new Date(0),
      pushedAt: new Date(0),
      defaultBranch: "main",
      stars: 0,
      topics: [],
      archived: false,
      commitCount: 0,
      lastCommit: new Date(0),
      mentionableUsersCount: 0,
      watchersCount: 0,
      licenseSpdxId: "",
      pullRequestsCount: 0,
      openIssuesCount: 0,
      releasesCount: 0,
      languages: [],
      forks: 0,
      openGraphImageUrl: "",
      usesCustomOpenGraphImage: false,
      latestReleaseName: "",
      latestReleaseTagName: "",
      latestReleasePublishedAt: undefined,
      latestReleaseUrl: "",
      latestReleaseDescription: "",
    }
  }

  /**
   * Fetches one repository, degrading the query rather than the result.
   *
   * 1. the full GraphQL query, which returns every count in one request;
   * 2. on `NOT_FOUND`, resolve the repository's current name over REST
   *    (projects get renamed and transferred) and retry against that;
   * 3. on `FORBIDDEN`, retry with a query that omits the connections a
   *    fine-grained token may not read, then backfill the counts from REST.
   *
   * A rate limit is never absorbed here: it is rethrown so the caller backs
   * off instead of spending the rest of its budget on retries.
   */
  async function fetchRepoInfoSafe(fullName: string): Promise<RepoInfo> {
    try {
      return await fetchRepoInfoMain(fullName)
    } catch (error) {
      if (error instanceof GitHubRateLimitError) throw error

      const graphqlType = graphqlErrorType(error)

      if (graphqlType === "NOT_FOUND") {
        const relocated = await fetchRepoInfoFallback(fullName)
        if (relocated.fullName === fullName) {
          // REST redirected to the name we already asked for, so the
          // repository was not renamed: it is gone or invisible to this
          // token. Retrying GraphQL would fail the same way.
          throw new GitHubNotFoundError(fullName, { cause: error })
        }
        return fetchRepoInfoMain(relocated.fullName)
      }

      if (
        graphqlType === "FORBIDDEN" ||
        error instanceof GitHubForbiddenError
      ) {
        const reduced = await fetchRepoInfoMain(fullName, queryRepoInfoBasic)
        return backfillRepoStats(reduced, fullName)
      }

      if (error instanceof GitHubGraphQLError) {
        throw new GitHubTransportError(
          `GraphQL error "${graphqlErrorMessage(error) ?? graphqlType}" ` +
            `for ${fullName}`,
          { cause: error }
        )
      }

      throw error
    }
  }

  // --- public API ----------------------------------------------------------

  /**
   * Per-repository fallback used when a batched request fails for a reason
   * specific to one entry. Reuses the full fallback chain, so it is slower
   * but at least as accurate as a single fetch.
   */
  async function fetchReposIndividually(
    fullNames: string[],
    results: Map<string, RepoInfo>,
    missing: string[]
  ): Promise<void> {
    for (const fullName of fullNames) {
      try {
        results.set(fullName, await fetchRepoInfoSafe(fullName))
      } catch (error) {
        if (error instanceof GitHubRateLimitError) throw error
        missing.push(fullName)
      }
    }
  }

  /**
   * Fetches many repositories, batched into a single GraphQL request per
   * group of {@link MAX_BATCH_SIZE}.
   *
   * Repositories GitHub cannot resolve are reported in `missing` rather
   * than failing the batch: a single deleted repository should not abort a
   * refresh of the other 499.
   */
  async function fetchRepos(fullNames: string[]): Promise<ReposBatchResult> {
    const results = new Map<string, RepoInfo>()
    const missing: string[] = []
    if (fullNames.length === 0) return { results, missing }

    for (let i = 0; i < fullNames.length; i += MAX_BATCH_SIZE) {
      const batch = fullNames.slice(i, i + MAX_BATCH_SIZE)
      const variables: BatchVariables = {}
      batch.forEach((fullName, index) => {
        const [owner, name] = fullName.split("/")
        if (!owner || !name) {
          missing.push(fullName)
          return
        }
        variables[`owner${index}`] = owner
        variables[`name${index}`] = name
      })

      let response: Record<string, unknown>
      try {
        response = await requestGraphQL<Record<string, unknown>>(
          buildBatchRepoInfoQuery(batch.length),
          variables
        )
      } catch (error) {
        // A batch-wide failure is almost always an auth or rate-limit
        // problem, which per-repository calls would hit too, so surface it
        // instead of silently marking the whole batch missing.
        if (
          error instanceof GitHubRateLimitError ||
          error instanceof GitHubForbiddenError
        ) {
          throw error
        }
        console.warn(
          `[github] batch of ${batch.length} failed, retrying individually`,
          error
        )
        await fetchReposIndividually(batch, results, missing)
        continue
      }

      batch.forEach((fullName, index) => {
        const node = response[`r${index}`]
        if (!node) {
          missing.push(fullName)
          return
        }
        try {
          results.set(fullName, extractRepoInfo({ repository: node }))
        } catch (error) {
          console.warn(`[github] could not parse ${fullName}`, error)
          missing.push(fullName)
        }
      })
    }

    return { results, missing }
  }

  return {
    fetchRepoInfo: fetchRepoInfoSafe,

    fetchRepoInfoFallback,

    fetchRepos,

    /**
     * Counts contributors through the REST API.
     *
     * The source implementation scraped the counter out of the repository
     * page HTML with a CSS selector, which returns 0 whenever GitHub changes
     * its markup and requires no token to run. Asking for a single
     * contributor and reading the `rel="last"` page from the `Link` header
     * is both exact and a single request.
     */
    async fetchContributorCount(fullName: string): Promise<number> {
      const response = await makeRestApiRequest(
        `repos/${fullName}/contributors?per_page=1&anon=false`
      )

      if (response.status === 202) {
        // GitHub computes contributor statistics asynchronously for large
        // repositories; 202 means the number is not ready yet.
        return 0
      }
      if (response.status === 404) {
        throw new GitHubNotFoundError(fullName)
      }
      if (!response.ok) {
        throw toGitHubError(
          new Error(`contributor lookup failed: ${response.statusText}`),
          { status: response.status, headers: response.headers }
        )
      }

      const contributors = (await response.json()) as unknown[]
      const link = response.headers.get("link")
      const lastPage = link
        ? /[?&]page=(\d+)[^>]*>\s*;\s*rel="last"/.exec(link)
        : null
      const last = lastPage?.[1] ? Number(lastPage[1]) : undefined

      if (last !== undefined) return last
      // No `last` rel means everything fits on the first page.
      return contributors.length
    },

    /**
     * Stargazers with timestamps, by login.
     *
     * `star+json` returns `{ starred_at, user: { login } }`, which the plain
     * media type does not: the default projection is a bare list of users, and
     * the timestamp is the entire reason for asking here.
     *
     * Supplying `since` asks GitHub for stargazers at or after an instant. That
     * is what makes a repeated sweep cheap — the stored high-water mark is passed
     * back as the floor, so the second pass costs one page rather than the whole
     * history — and it is also why this is a supplement rather than the primary
     * source: GitHub silently ignores the parameter on endpoints it does not
     * filter by it, so a sweep must never assume the response was narrowed.
     *
     * A 403 throws `GitHubForbiddenError`; a rate-limited 403 throws
     * `GitHubRateLimitError`. The distinction matters because the two call sites
     * want opposite behaviour: an unprivileged repository is an expected outcome
     * to skip past, while a rate limit must stop the sweep rather than be
     * recorded as "this repository has no readable stargazers".
     */
    async fetchStargazersWithTimestamps(
      fullName: string,
      onPage: (stargazers: { login: string; starred_at: string }[]) => void,
      options: { since?: Date } = {}
    ): Promise<void> {
      let page = 1
      const since = options.since
        ? `&since=${encodeURIComponent(options.since.toISOString())}`
        : ""

      // 100 is GitHub's maximum per_page; a 400k-star repository is 4000 pages,
      // so this is bounded but intentionally unbounded overall. Callers that do
      // not pass `since` are the ones paying that.
      for (;;) {
        const response = await makeRestApiRequest(
          `repos/${fullName}/stargazers?per_page=100&page=${page}${since}`,
          "application/vnd.github.star+json"
        )

        if (!response.ok) {
          if (response.status === 404) {
            throw new GitHubNotFoundError(fullName)
          }
          throw toGitHubError(
            new Error(`stargazer lookup failed: ${response.statusText}`),
            { status: response.status, headers: response.headers }
          )
        }

        const stargazers = (await response.json()) as {
          starred_at?: string
          user?: { login?: string }
        }[]
        if (stargazers.length === 0) return

        const usable = stargazers.filter(
          (entry): entry is { starred_at: string; user: { login: string } } =>
            typeof entry.starred_at === "string" &&
            typeof entry.user?.login === "string"
        )
        if (usable.length > 0) {
          onPage(
            usable.map((entry) => ({
              login: entry.user.login,
              starred_at: entry.starred_at,
            }))
          )
        }

        if (stargazers.length < 100) return
        page += 1
      }
    },

    /**
     * Star history, as GitHub's own weekly buckets.
     *
     * One request answers "how many stars did this repository gain in each of
     * the last hundred weeks", which no other endpoint can: the stargazer list is
     * one row per star, so a repository with 40k stars is 400 pages to answer the
     * same question. That difference is why this is the primary source and the
     * stargazer walk is kept as a supplement.
     *
     * Each entry is `{ week, total, days[7] }` where `week` is a Unix timestamp
     * for the start of a Sunday-based week and `total` is the cumulative star
     * count at its end. The `days` array is Monday-first — it starts at the day
     * after `week`, which is a Sunday — so callers wanting calendar days index
     * it accordingly rather than assuming it lines up with the bucket.
     *
     * `per_page` is capped at 30 by GitHub regardless of what is asked for, and
     * `page` stops at 100, so a repository older than roughly 55 weeks needs
     * something else for its deep history. That limit is the caller's to work
     * around, and is why the sweep passes a page count and reports what it got.
     */
    async fetchStarHistory(
      fullName: string,
      options: { pages?: number } = {}
    ): Promise<StarHistoryEntry[]> {
      const pages = options.pages ?? HISTORY_MAX_PAGES
      const entries: StarHistoryEntry[] = []

      for (let page = 1; page <= pages; page++) {
        const response = await makeRestApiRequest(
          `repos/${fullName}/stargazers/history?per_page=${HISTORY_PAGE_SIZE}&page=${page}`
        )

        if (!response.ok) {
          if (response.status === 404) {
            throw new GitHubNotFoundError(fullName)
          }
          throw toGitHubError(
            new Error(`star history lookup failed: ${response.statusText}`),
            { status: response.status, headers: response.headers }
          )
        }

        const batch = (await response.json()) as unknown
        if (!Array.isArray(batch) || batch.length === 0) break

        for (const raw of batch) {
          const entry = parseStarHistoryEntry(raw)
          if (entry) entries.push(entry)
        }

        // GitHub answers a page past the end with 200 and an empty array, so the
        // loop above cannot tell "no more" from "rate limited into silence" —
        // an empty body is the only signal, and it is checked here rather than by
        // running to the page cap on every repository.
        if (batch.length < HISTORY_PAGE_SIZE) break
      }

      return entries
    },

    async fetchUserInfo(login: string) {
      return extractUserInfo(await requestGraphQL(queryUserInfo, { login }))
    },

    async fetchRepoReadMeAsHtml(fullName: string, branch = "main") {
      const response = await makeRestApiRequest(
        `repos/${fullName}/readme`,
        "application/vnd.github.VERSION.html"
      )
      if (!response.ok) {
        if (response.status === 404) {
          throw new GitHubNotFoundError(`${fullName}/readme`)
        }
        throw toGitHubError(
          new Error(`README fetch failed: ${response.statusText}`),
          { status: response.status, headers: response.headers }
        )
      }
      const html = await response.text()
      return processReadMeHtml(html, fullName, branch)
    },

    /**
     * Returns the README as Markdown, or null when the repository has none.
     * A missing README is a normal outcome, not an error, so it is reported
     * as null rather than thrown.
     */
    async fetchRepoReadMeAsMarkdown(
      fullName: string,
      branch = "main"
    ): Promise<string | null> {
      try {
        const response = await makeRestApiRequest(
          `repos/${fullName}/readme?ref=${encodeURIComponent(branch)}`,
          "application/vnd.github.v3.raw"
        )

        if (response.status === 404) return null
        if (!response.ok) {
          throw toGitHubError(
            new Error(`README fetch failed: ${response.statusText}`),
            { status: response.status, headers: response.headers }
          )
        }

        const markdown = await response.text()
        return processReadMeMd(markdown, fullName, branch)
      } catch (error) {
        if (
          error instanceof GitHubRateLimitError ||
          error instanceof GitHubNotFoundError
        ) {
          throw error
        }
        console.warn(`[github] could not read README for ${fullName}`, error)
        return null
      }
    },

    /**
     * Reads one path, reporting what it turned out to be.
     *
     * The Contents API answers a directory with an array and a file with an
     * object, so one request settles both questions. That is what lets a caller
     * treat "a document" and "a directory of documents" as two shapes of the
     * same path instead of guessing which one it is from the name.
     *
     * A path that is not there raises `GitHubNotFoundError`, which is a
     * permanent answer rather than a request worth repeating.
     */
    async readPath(
      fullName: string,
      path: string,
      branch?: string
    ): Promise<PathContent> {
      const branchQuery = branch ? `?ref=${encodeURIComponent(branch)}` : ""
      const data = (await makeRestApiRequestJson(
        `repos/${fullName}/contents/${path}${branchQuery}`
      )) as ContentsEntry | ContentsEntry[] | null

      if (Array.isArray(data)) {
        return {
          kind: "directory",
          entries: data
            .filter((entry) => entry?.name && entry?.path)
            .map((entry) => ({
              name: entry.name as string,
              path: entry.path as string,
              type: entry.type ?? "file",
            })),
        }
      }

      // Narrowed rather than cast: a body that is neither an array nor an
      // object with content must reach the error below as a typed GitHub
      // failure, not as a TypeError from reading a property of `null`.
      const file = (data ?? {}) as ContentsEntry
      if (file.encoding === "base64" && file.content) {
        // The API wraps base64 at 60 characters; the newlines must go before
        // decoding.
        return {
          kind: "file",
          content: Buffer.from(
            file.content.replace(/\n/g, ""),
            "base64"
          ).toString("utf-8"),
        }
      }
      if (typeof file.content === "string") {
        return { kind: "file", content: file.content }
      }

      // A file over 1 MB comes back as an object with no content, because the
      // API does not inline those. Reported as an error rather than as an empty
      // file, which would look like a skill with nothing in it.
      throw new GitHubTransportError(
        `GitHub returned no content for ${fullName}/${path}`,
        { status: 200 }
      )
    },

    /**
     * Every `SKILL.md` in the repository, found with one request.
     *
     * The Contents API can only answer for a path somebody already named, so
     * locating skills in an unfamiliar repository through it means guessing a
     * layout and spending a request on every wrong guess. The recursive trees
     * API answers the other question — "which of these paths is a skill
     * document" — directly, so the layouts this repository happens to use are
     * discovered rather than enumerated here.
     *
     * `truncated` is reported rather than hidden: GitHub stops after 100k
     * entries, and a caller that treats a cut-off list as complete would record
     * a repository's skills as a shorter list than it is.
     */
    async findSkillDocuments(
      fullName: string,
      branch?: string
    ): Promise<{ paths: string[]; truncated: boolean }> {
      // `HEAD` rather than an omitted ref: the endpoint requires a tree-ish, and
      // `readPath` above already treats an unknown branch as not-found, so a
      // missing one here is the same permanent answer rather than a new error.
      const treeish = encodeURIComponent(branch ?? "HEAD")
      const data = (await makeRestApiRequestJson(
        `repos/${fullName}/git/trees/${treeish}?recursive=1`
      )) as { tree?: unknown; truncated?: unknown } | null

      const entries = Array.isArray(data?.tree) ? data.tree : []
      const paths: string[] = []
      for (const entry of entries) {
        const item = entry as { path?: unknown; type?: unknown }
        // Blobs only: a tree entry named `SKILL.md` is a directory that happens
        // to carry the name, and reading it as a document would yield the
        // directory's first file instead of a skill.
        if (item?.type !== "blob") continue
        if (typeof item.path !== "string") continue
        if (item.path === "SKILL.md" || item.path.endsWith("/SKILL.md")) {
          paths.push(item.path)
        }
      }

      return { paths, truncated: data?.truncated === true }
    },

    /**
     * Searches repositories. Used by the discovery task to find new skill
     * and MCP repositories.
     */
    async searchRepositories(
      query: string,
      options: { perPage?: number; sort?: "stars" | "updated" } = {}
    ): Promise<{ fullName: string; description: string; stars: number }[]> {
      const params = new URLSearchParams({
        q: query,
        per_page: String(Math.min(options.perPage ?? 30, 100)),
        sort: options.sort ?? "stars",
        order: "desc",
      })
      const result = (await makeRestApiRequestJson(
        `search/repositories?${params.toString()}`
      )) as { items?: unknown[] }

      const items = Array.isArray(result?.items) ? result.items : []
      return items.map((item) => {
        const entry = item as {
          full_name?: string
          description?: string | null
          stargazers_count?: number
        }
        return {
          fullName: entry.full_name ?? "",
          description: entry.description ?? "",
          stars: entry.stargazers_count ?? 0,
        }
      })
    },

    /**
     * Lists every repository owned by a user, used to seed the curated
     * accounts in the discovery task.
     */
    async listUserRepositories(
      login: string,
      options: { perPage?: number } = {}
    ): Promise<{ fullName: string; description: string; stars: number }[]> {
      const perPage = Math.min(options.perPage ?? 100, 100)
      const collected: {
        fullName: string
        description: string
        stars: number
      }[] = []

      for (let page = 1; page <= 10; page += 1) {
        const result = (await makeRestApiRequestJson(
          `users/${login}/repos?per_page=${perPage}&page=${page}&sort=pushed`
        )) as unknown[]

        if (!Array.isArray(result) || result.length === 0) break
        for (const item of result) {
          const entry = item as {
            full_name?: string
            description?: string | null
            stargazers_count?: number
          }
          if (!entry.full_name) continue
          collected.push({
            fullName: entry.full_name,
            description: entry.description ?? "",
            stars: entry.stargazers_count ?? 0,
          })
        }
        if (result.length < perPage) break
      }

      return collected
    },
  }
}

export type GitHubClient = ReturnType<typeof createGitHubClient>
