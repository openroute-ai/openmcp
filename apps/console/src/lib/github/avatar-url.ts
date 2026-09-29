/**
 * GitHub avatar URLs.
 *
 * A project is published under a GitHub account, and that account's avatar is
 * the one mark available for every project without a separate fetch.
 *
 * There are two forms, and they are not interchangeable:
 *
 * - `avatars.githubusercontent.com/u/<id>?s=<size>` is the CDN itself, and it
 *   honours the size. Serving a 56px avatar from it costs about 4KB.
 * - `github.com/<login>.png` is a redirect to that CDN, and it **drops the
 *   query string**: `github.com/octocat.png?s=56` lands on
 *   `avatars.githubusercontent.com/u/583231?v=4` and serves the full 460px
 *   image, about 23KB. Fine as a fallback, wasteful as a default.
 *
 * So the id is preferred and the login is the fallback. The id is not always
 * known — a repository reaches the database through several paths, and the id
 * is parsed out of the owner's avatar URL, so it is absent whenever that parse
 * failed — while the login always is, because a project is created from a
 * repository and inherits its owner.
 *
 * Deriving the URL rather than storing an avatar also means a project keeps
 * showing the owner's current avatar after they change it.
 */

/**
 * GitHub logins are letters, digits and single hyphens, cannot start or end
 * with a hyphen, and are at most 39 characters.
 *
 * The value ends up inside a URL path, so this is what keeps a stored owner
 * from steering the avatar at another host or another path. The same reasoning
 * as the repository segment check in `repo-url.ts`.
 */
const GITHUB_LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/

const CDN_BASE = "https://avatars.githubusercontent.com/u"

function withSize(url: string, size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size <= 0) return url
  return `${url}?v=3&s=${Math.round(size)}`
}

/**
 * The avatar URL for a GitHub account, or null if neither identifier is one
 * that could have come from GitHub.
 *
 * Null rather than a broken URL: every caller has a fallback to render, and
 * handing them an image that cannot load only moves the failure a screen away.
 */
export function githubAvatarUrl(
  owner: string | null | undefined,
  options: { ownerId?: number | null; size?: number } = {}
): string | null {
  const { ownerId, size } = options

  if (typeof ownerId === "number" && Number.isSafeInteger(ownerId) && ownerId > 0) {
    return withSize(`${CDN_BASE}/${ownerId}`, size)
  }

  if (!owner) return null

  const login = owner.trim()
  if (!GITHUB_LOGIN_RE.test(login)) return null

  // No size: the redirect discards it, so asking for one would only be a lie
  // about what was fetched.
  return `https://github.com/${login}.png`
}
