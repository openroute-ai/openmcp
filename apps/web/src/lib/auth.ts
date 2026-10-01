import { nextCookies } from 'better-auth/next-js'
import {
  admin as adminPlugin,
  lastLoginMethod,
  organization as organizationPlugin,
} from 'better-auth/plugins'
import { admin, createAuth, member as memberRole, owner } from '@workspace/auth'
import { createId, member, organization } from '@workspace/db'
import { db } from './db'
import { subscribeToNewsletter } from './newsletter'
import { sendEmail } from '@/mail'
import { websiteConfig } from './config/website'
import { LOCALE_COOKIE_NAME, routing, type Locale } from '@/i18n/routing'
import { getSocialProviderOptions } from './auth/social-providers'
import { getUrlWithLocaleInCallbackUrl } from './urls/urls'

/** URL- and case-safe form of a display name, used to derive an org slug. */
const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'org'

/**
 * Reads the visitor's chosen locale off a request.
 *
 * Better Auth hands the originating request to every mail callback, but the
 * locale is not part of its payload, so the only signal is the cookie
 * next-intl writes on locale switch. Anything unreadable falls back to the
 * default locale rather than guessing, since a wrong prefix only lands the user
 * on a translated page.
 */
export function getLocaleFromRequest(request?: Request): Locale {
  const cookieHeader = request?.headers.get('cookie') ?? ''
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === LOCALE_COOKIE_NAME)

  const value = match?.[1] ? decodeURIComponent(match[1]) : undefined
  return (routing.locales as readonly string[]).includes(value ?? '')
    ? (value as Locale)
    : routing.defaultLocale
}

export const auth = createAuth(db, {
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: websiteConfig.auth.trustedOrigins,
  socialProviders: getSocialProviderOptions(),
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      domain: websiteConfig.auth.cookieDomain,
      additionalCookies: ['better-auth.session_token'],
    },
  },
  emailAndPassword: {
    enabled: true,
    // https://www.better-auth.com/docs/concepts/email#2-require-email-verification
    requireEmailVerification: websiteConfig.auth.requireEmailVerification,
    // https://www.better-auth.com/docs/authentication/email-password#forget-password
    async sendResetPassword({ user, url }, request) {
      const locale = getLocaleFromRequest(request)

      await sendEmail({
        to: user.email,
        template: 'forgotPassword',
        context: { url: getUrlWithLocaleInCallbackUrl(url, locale), name: user.name },
        locale,
      })
    },
  },
  emailVerification: {
    // https://www.better-auth.com/docs/concepts/email#auto-signin-after-verification
    autoSignInAfterVerification: websiteConfig.auth.autoSignInAfterVerification,
    // https://www.better-auth.com/docs/authentication/email-password#require-email-verification
    async sendVerificationEmail({ user, url }, request) {
      const locale = getLocaleFromRequest(request)

      await sendEmail({
        to: user.email,
        template: 'verifyEmail',
        context: { url: getUrlWithLocaleInCallbackUrl(url, locale), name: user.name },
        locale,
      })
    },
    /**
     * Subscribe the address to the newsletter once it is verified.
     *
     * Gated on the same flag as the marketing forms: an address that verified
     * its inbox is by definition deliverable, but a deployment that does not
     * run a newsletter should not silently write rows nobody sends from.
     */
    async afterEmailVerification(user) {
      if (!websiteConfig.newsletter.autoSubscribeAfterSignUp || !user.email) return

      await subscribeToNewsletter(user.email, {
        userId: user.id,
        source: 'email-verification',
      })
    },
  },
  account: {
    // https://www.better-auth.com/docs/concepts/users-accounts#account-linking
    accountLinking: {
      enabled: true,
      // A GitHub account proves the address, so it satisfies an existing
      // email/password account instead of colliding with it on `email` unique.
      trustedProviders: ['github'],
    },
  },
  databaseHooks: {
    // https://www.better-auth.com/docs/concepts/database#database-hooks
    user: {
      create: {
        /**
         * Every account gets a personal organization, because the gateway, key
         * and usage tables all key on `organizationId` rather than `userId`.
         *
         * Written directly rather than through `auth.api.createOrganization`:
         * the plugin's server endpoints are not part of this factory's inferred
         * API surface, so calling one would need an untyped cast, and an
         * explicit insert keeps the two rows (`organization` + `member`) visible
         * next to the values they are given.
         */
        after: async (user) => {
          const name = user.name ?? user.email?.split('@')[0] ?? 'user'

          try {
            const organizationId = createId()
            // Slugs are unique. Two users can pick the same display name, and a
            // collision must not fail the sign-up that is already committed, so
            // a slice of the user id disambiguates instead.
            const slug = `${slugify(name)}-${user.id.slice(0, 8)}`

            await db.transaction(async (tx) => {
              await tx.insert(organization).values({ id: organizationId, name, slug })
              // The creator owns what they just made, which is what makes
              // `activeOrganizationId`-scoped permission checks work for them.
              await tx.insert(member).values({
                id: createId(),
                organizationId,
                userId: user.id,
                role: 'owner',
              })
            })
          } catch (error) {
            console.error('failed to create organization for new user:', error)
          }
        },
      },
    },
  },
  onAPIError: {
    // https://www.better-auth.com/docs/reference/options#onapierror
    errorURL: '/auth/error',
    onError: (error, ctx) => {
      console.error('auth error:', error, ctx?.session?.user)
    },
  },
  plugins: [
    organizationPlugin({
      async sendInvitationEmail(data) {
        // Acceptance is a signed-in action, so the link targets this app's own
        // route: Better Auth's default accept flow requires the invitee to
        // already hold a session, which a brand-new invitee does not.
        const inviteLink = `${websiteConfig.metadata.base_url}/auth/invitation/${data.id}`

        await sendEmail({
          to: data.email,
          template: 'organizationInvitation',
          context: {
            inviteLink,
            email: data.email,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
          },
        })
      },
      roles: { owner, admin, member: memberRole },
    }),
    // https://www.better-auth.com/docs/plugins/admin
    // Bans, unbans and role management for the admin console.
    adminPlugin({
      bannedUserMessage:
        'You have been banned from this application. Please contact support if you believe this is an error.',
    }),
    // https://www.better-auth.com/docs/plugins/last-login-method
    // Lets the sign-in form show which method was used last.
    lastLoginMethod(),
    // Flushes the session cookie from server actions and route handlers.
    nextCookies(),
  ],
})
