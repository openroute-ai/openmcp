export const queryUserInfo = /* GraphQL */ `
  query queryUserInfo($login: String!) {
    user(login: $login) {
      login
      name
      bio
      avatarUrl
      websiteUrl
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
  }
}
