/**
 * GitHub repository reference parsing.
 *
 * Accepts the shapes a human is likely to paste into the console, or that
 * another application is likely to send:
 * - bare: `owner/repo`, `owner/repo.git`
 * - full URL: `https://github.com/owner/repo`, with a trailing slash or path
 * - scheme-less: `github.com/owner/repo`
 * - SSH: `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo`
 *
 * Normalises everything to `owner/name` and drops `.git`, trailing slashes
 * and any extra path segment, so `https://github.com/o/r/tree/main` and
 * `o/r` resolve to the same repository.
 */

export interface ParsedGitHubRepo {
  owner: string
  name: string
  fullName: string
  url: string
}

/**
 * GitHub only allows letters, digits, dots, hyphens and underscores in
 * owner and repository names. Checking this rejects traversal attempts
 * (`../../etc/passwd`) that would otherwise reach the GitHub URL.
 */
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_.-]+$/

export function parseGithubRepoUrl(
  input: string | null | undefined
): ParsedGitHubRepo | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null

  let match = raw.match(
    /(?:https?:\/\/|ssh:\/\/[^/]+@)?(?:www\.)?github\.com[/:]([^/\s?#]+)\/([^/\s?#]+)/i
  )

  if (!match) {
    match = raw.match(/^git@github\.com[/:]([^/\s?#]+)\/([^/\s?#]+)/i)
  }

  if (!match) {
    match = raw.match(/^([^/\s?#]+)\/([^/\s?#]+)$/)
  }

  if (!match) return null

  const owner = match[1]?.replace(/\/+$/, "") ?? ""
  const name = (match[2]?.replace(/\.git$/i, "") ?? "").replace(/\/+$/, "")

  if (!owner || !name) return null
  if (!SAFE_SEGMENT_RE.test(owner) || !SAFE_SEGMENT_RE.test(name)) return null
  if (owner === "." || name === "." || owner === ".." || name === "..") {
    return null
  }

  const fullName = `${owner}/${name}`
  return {
    owner,
    name,
    fullName,
    url: `https://github.com/${fullName}`,
  }
}

/** Normalises any repository input to `owner/name`, or null if unparseable. */
export function normalizeGithubRepoInput(
  input: string | null | undefined
): string | null {
  return parseGithubRepoUrl(input)?.fullName ?? null
}
