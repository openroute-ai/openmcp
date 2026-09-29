/**
 * The GitHub profile behind an author entry.
 *
 * An author is derived from a repository's owner, so the identity is known and
 * only the display details need fetching. The fields asked for are the ones an
 * author card actually shows: a name that is not the login, a bio, a follower
 * count, an avatar, a home page, and a Twitter handle.
 *
 * `twitterUser` is a distinct object rather than a string on the user, which is
 * why it is nested here and flattened in {@link extractUserInfo}.
 */
export const queryUserInfo = /* GraphQL */ `
  query queryUserInfo($login: String!) {
    user(login: $login) {
      login
      name
      bio
      avatarUrl
      websiteUrl
      twitterUser {
        username
      }
      followers {
        totalCount
      }
    }
  }
`

export type UserInfo = {
  login: string
  name: string
  bio: string
  followers: number
  avatarUrl: string
  websiteUrl: string
  /** Empty when the account has no Twitter handle linked. */
  twitter: string
}

export function extractUserInfo(response: unknown): UserInfo {
  const user = (response as { user?: Record<string, unknown> } | null)?.user
  if (!user) {
    throw new Error("User data not found in response")
  }

  return {
    login: String(user.login ?? ""),
    name: String(user.name ?? user.login ?? ""),
    bio: String(user.bio ?? ""),
    followers: Number(
      (user.followers as { totalCount?: number } | null)?.totalCount ?? 0
    ),
    avatarUrl: String(user.avatarUrl ?? ""),
    websiteUrl: String(user.websiteUrl ?? ""),
    twitter: String(
      (user.twitterUser as { username?: string } | null)?.username ?? ""
    ),
  }
}
