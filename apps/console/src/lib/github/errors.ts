/**
 * Typed GitHub failures.
 *
 * The source app matched on GraphQL error *strings* and `error.response.
 * errors[0].type`, so a rate limit, a missing repository and a token that
 * lacks a scope were indistinguishable at the call site. Each of those
 * needs a different reaction — give up, retry later, or degrade the field
 * set — so they are modelled explicitly here.
 */

export interface GitHubErrorOptions {
  cause?: unknown
  /** The HTTP status, when the failure came from a response. */
  status?: number
}

export class GitHubError extends Error {
  readonly options: GitHubErrorOptions
  readonly status: number | undefined

  constructor(message: string, options: GitHubErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = "GitHubError"
    this.options = options
    this.status = options.status
  }
}

/** Repository, user or file does not exist (or is not visible to the token). */
export class GitHubNotFoundError extends GitHubError {
  constructor(resource: string, options: { cause?: unknown } = {}) {
    super(`GitHub resource not found: ${resource}`, options)
    this.name = "GitHubNotFoundError"
  }
}

/** The token is valid but not allowed to read this resource. */
export class GitHubForbiddenError extends GitHubError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options)
    this.name = "GitHubForbiddenError"
  }
}

/** Primary or secondary rate limit hit. Carries the reset time when known. */
export class GitHubRateLimitError extends GitHubError {
  constructor(
    message: string,
    readonly resetAt: Date | undefined,
    options: { cause?: unknown } = {}
  ) {
    super(message, options)
    this.name = "GitHubRateLimitError"
  }

  /** Seconds the caller should wait before retrying, 0 when unknown. */
  retryAfterSeconds(): number {
    if (!this.resetAt) return 0
    return Math.max(0, Math.ceil((this.resetAt.getTime() - Date.now()) / 1000))
  }
}

/** Network failure, DNS error, or a response that could not be parsed. */
export class GitHubTransportError extends GitHubError {
  constructor(
    message: string,
    options: { cause?: unknown; status?: number } = {}
  ) {
    super(message, options)
    this.name = "GitHubTransportError"
  }
}

export interface GraphQLErrorDetail {
  type?: string
  message?: string
  path?: (string | number)[]
}

/**
 * A GraphQL request that returned HTTP 200 with an `errors` array, which is
 * how GitHub reports a *partial* failure: the rest of the selection resolved
 * and only some field did not.
 *
 * This is the error the three-tier fallback keys off, so the `type`
 * discriminator (`NOT_FOUND`, `FORBIDDEN`, ...) is carried explicitly
 * instead of being re-parsed out of a response object further up the call
 * stack.
 */
export class GitHubGraphQLError extends GitHubError {
  readonly type: string | undefined
  readonly detailMessage: string | undefined
  readonly errors: GraphQLErrorDetail[]

  constructor(errors: GraphQLErrorDetail[], options: { cause?: unknown } = {}) {
    const first = errors[0]
    super(
      `GitHub GraphQL error: ${first?.message ?? "unknown"}` +
        (first?.type ? ` (${first.type})` : ""),
      options
    )
    this.name = "GitHubGraphQLError"
    this.errors = errors
    this.type = first?.type
    this.detailMessage = first?.message
  }
}

/** True when the error is worth retrying after a delay. */
export function isRetryableGitHubError(error: unknown): boolean {
  return (
    error instanceof GitHubRateLimitError ||
    error instanceof GitHubTransportError
  )
}

/**
 * Normalises whatever `fetch`/GraphQL threw into a typed error.
 *
 * GitHub reports primary rate limits with HTTP 403 plus
 * `x-ratelimit-remaining: 0`; secondary limits and abuse detection also
 * arrive as 403 but with a `retry-after` header and no remaining-budget
 * header. Both are retryable, so the two cases are distinguished by their
 * headers rather than their status code.
 */
export function toGitHubError(
  error: unknown,
  context: { status?: number; headers?: Headers; body?: unknown }
): GitHubError {
  if (error instanceof GitHubError) return error

  const { status, headers, body } = context
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error")

  if (status === 404) {
    return new GitHubNotFoundError("request returned 404", { cause: error })
  }

  if (status === 429 || (status === 403 && headers?.has("retry-after"))) {
    const reset = headers?.get("retry-after")
    return new GitHubRateLimitError(
      `GitHub secondary rate limit: ${message}`,
      reset ? new Date(Date.now() + Number(reset) * 1000) : undefined,
      { cause: error }
    )
  }

  if (status === 403) {
    const remaining = headers?.get("x-ratelimit-remaining")
    if (remaining === "0") {
      const resetAt = headers?.get("x-ratelimit-reset")
      return new GitHubRateLimitError(
        `GitHub primary rate limit exhausted: ${message}`,
        resetAt ? new Date(Number(resetAt) * 1000) : undefined,
        { cause: error }
      )
    }
    return new GitHubForbiddenError(`GitHub forbidden: ${message}`, {
      cause: error,
    })
  }

  if (status === 401) {
    return new GitHubForbiddenError(
      "GitHub rejected the access token (401). Check GITHUB_ACCESS_TOKEN.",
      { cause: error }
    )
  }

  if (status !== undefined && status >= 500) {
    return new GitHubTransportError(`GitHub returned ${status}: ${message}`, {
      cause: error,
    })
  }

  return new GitHubTransportError(`GitHub request failed: ${message}`, {
    cause: body ?? error,
  })
}

/**
 * Reads the GraphQL `errors[].type` discriminator GitHub attaches to
 * field-level failures. `NOT_FOUND` means the repository is missing or was
 * renamed; `FORBIDDEN` means the token lacks access to that connection.
 *
 * Accepts the typed error as well as a raw `graphql-request` `ClientError`,
 * so a caller that forgot to normalise still gets an answer.
 */
export function graphqlErrorType(error: unknown): string | undefined {
  if (error instanceof GitHubGraphQLError) return error.type
  if (!error || typeof error !== "object") return undefined
  const response = (error as { response?: { errors?: unknown } }).response
  const errors = response?.errors
  if (!Array.isArray(errors) || errors.length === 0) return undefined
  const first = errors[0] as { type?: string } | undefined
  return first?.type
}

export function graphqlErrorMessage(error: unknown): string | undefined {
  if (error instanceof GitHubGraphQLError) return error.detailMessage
  if (!error || typeof error !== "object") return undefined
  const response = (error as { response?: { errors?: unknown } }).response
  const errors = response?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    return (errors[0] as { message?: string } | undefined)?.message
  }
  const message = (error as { response?: { message?: string } }).response
  return message?.message
}
