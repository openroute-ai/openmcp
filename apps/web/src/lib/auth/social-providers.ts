import { websiteConfig } from '@/lib/config/website'

export type SocialProviderId = 'google' | 'github'

/**
 * Credentials for each provider, keyed the same way as the id.
 *
 * Read from the environment rather than passed in so the server config and the
 * sign-in button list are derived from one source: a button for a provider the
 * server did not register would fail the exchange instead of hiding.
 */
const credentials: Record<
  SocialProviderId,
  { enabled: () => boolean; clientId?: string; clientSecret?: string }
> = {
  google: {
    enabled: () => websiteConfig.auth.enableGoogleLogin,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  github: {
    enabled: () => websiteConfig.auth.enableGithubLogin,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
}

/**
 * Providers that are switched on *and* fully configured.
 *
 * Both halves matter: registering a provider with an empty `clientId` does not
 * disable it — Better Auth still mounts the callback route and fails the
 * exchange at runtime — so a half-configured deployment has to stay
 * unregistered rather than merely failing one sign-in.
 */
export function getEnabledSocialProviders(): SocialProviderId[] {
  return (Object.keys(credentials) as SocialProviderId[]).filter((id) => {
    const provider = credentials[id]
    return (
      provider.enabled() && !!provider.clientId && !!provider.clientSecret
    )
  })
}

/** Options for Better Auth's `socialProviders`, keyed by provider id. */
export function getSocialProviderOptions(): Record<
  SocialProviderId,
  { clientId: string; clientSecret: string }
> {
  const enabled = getEnabledSocialProviders()
  const options = {} as Record<SocialProviderId, { clientId: string; clientSecret: string }>

  for (const id of enabled) {
    options[id] = {
      clientId: credentials[id].clientId!,
      clientSecret: credentials[id].clientSecret!,
    }
  }

  return options
}
