import { describe, expect, it } from "vitest"
import {
  GitHubForbiddenError,
  GitHubGraphQLError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTransportError,
  graphqlErrorMessage,
  graphqlErrorType,
  isRetryableGitHubError,
  toGitHubError,
} from "@/lib/github/errors"

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

describe("toGitHubError", () => {
  it("maps 404 to not found", () => {
    const error = toGitHubError(new Error("nope"), { status: 404 })
    expect(error).toBeInstanceOf(GitHubNotFoundError)
    expect(isRetryableGitHubError(error)).toBe(false)
  })

  it("classifies a primary rate limit as retryable, not forbidden", () => {
    // The bug this guards: a throttled GraphQL request is a 403, and a
    // 403 with an exhausted budget must never be mistaken for a token that
    // merely lacks a scope, because the response to those is to retry.
    const error = toGitHubError(new Error("rate limited"), {
      status: 403,
      headers: headers({
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
      }),
    })

    expect(error).toBeInstanceOf(GitHubRateLimitError)
    expect(error).not.toBeInstanceOf(GitHubForbiddenError)
    expect(isRetryableGitHubError(error)).toBe(true)
    expect((error as GitHubRateLimitError).retryAfterSeconds()).toBeGreaterThan(0)
  })

  it("classifies a 403 with budget left as forbidden", () => {
    const error = toGitHubError(new Error("forbidden"), {
      status: 403,
      headers: headers({ "x-ratelimit-remaining": "4999" }),
    })
    expect(error).toBeInstanceOf(GitHubForbiddenError)
    expect(error).not.toBeInstanceOf(GitHubRateLimitError)
  })

  it("classifies 429 and secondary limits as retryable", () => {
    expect(toGitHubError(new Error("x"), { status: 429 })).toBeInstanceOf(
      GitHubRateLimitError
    )
    expect(
      toGitHubError(new Error("x"), {
        status: 403,
        headers: headers({ "retry-after": "30" }),
      })
    ).toBeInstanceOf(GitHubRateLimitError)
  })

  it("treats an expired or rejected token as forbidden", () => {
    const error = toGitHubError(new Error("bad credentials"), { status: 401 })
    expect(error).toBeInstanceOf(GitHubForbiddenError)
    expect(error.message).toMatch(/GITHUB_ACCESS_TOKEN/)
  })

  it("treats 5xx as a transport error", () => {
    const error = toGitHubError(new Error("boom"), { status: 503 })
    expect(error).toBeInstanceOf(GitHubTransportError)
    expect(isRetryableGitHubError(error)).toBe(true)
  })

  it("returns an already typed error unchanged", () => {
    const original = new GitHubNotFoundError("owner/repo")
    expect(toGitHubError(original, { status: 500 })).toBe(original)
  })

  it("reports a zero retry delay when the reset time is unknown", () => {
    const error = new GitHubRateLimitError("no reset", undefined)
    expect(error.retryAfterSeconds()).toBe(0)
  })
})

describe("GitHubGraphQLError", () => {
  it("exposes the type discriminator and message for the fallback chain", () => {
    const error = new GitHubGraphQLError([
      { type: "NOT_FOUND", message: "Could not resolve to a Repository" },
    ])

    expect(graphqlErrorType(error)).toBe("NOT_FOUND")
    expect(graphqlErrorMessage(error)).toBe(
      "Could not resolve to a Repository"
    )
    expect(error.message).toContain("NOT_FOUND")
  })

  it("handles an error entry with no type", () => {
    const error = new GitHubGraphQLError([{ message: "something" }])
    expect(graphqlErrorType(error)).toBeUndefined()
    expect(graphqlErrorMessage(error)).toBe("something")
  })

  it("is not retryable, because retrying the same query cannot help", () => {
    expect(isRetryableGitHubError(new GitHubGraphQLError([{}]))).toBe(false)
  })
})

describe("graphqlErrorType", () => {
  it("reads a raw graphql-request ClientError shape", () => {
    const raw = {
      response: { errors: [{ type: "FORBIDDEN", message: "no access" }] },
    }
    expect(graphqlErrorType(raw)).toBe("FORBIDDEN")
    expect(graphqlErrorMessage(raw)).toBe("no access")
  })

  it("returns undefined for anything unrecognisable", () => {
    expect(graphqlErrorType(null)).toBeUndefined()
    expect(graphqlErrorType("boom")).toBeUndefined()
    expect(graphqlErrorType({})).toBeUndefined()
    expect(graphqlErrorType({ response: { errors: [] } })).toBeUndefined()
  })
})
