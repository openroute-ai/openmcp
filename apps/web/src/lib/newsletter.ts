import { eq } from 'drizzle-orm'
import { createId, newsletterSubscription } from '@workspace/db'
import { db } from '@/lib/db'
import { sendEmail } from '@/mail'

interface SubscribeOptions {
  /** Set when the signup is bound to a signed-in account. */
  userId?: string | null
  /** Where the signup came from, e.g. `website` or `auth-verification`. */
  source?: string
  /**
   * Overwrite `source` on an address that is already on the list.
   *
   * Off by default: a re-subscribe carrying no source (the settings toggle) must
   * keep the original campaign attribution rather than blanking it.
   */
  updateSource?: boolean
  /** Locale for the confirmation mail; defaults to the request locale upstream. */
  locale?: 'en' | 'zh'
}

/**
 * Addresses that must never reach the list.
 *
 * Better Auth synthesises one for phone-only accounts, and those are internal
 * identities rather than real inboxes — mailing them would bounce.
 */
const isSyntheticAddress = (email: string) => email.endsWith('@phone.openmcp.cn')

/**
 * Adds an address to the newsletter, or re-subscribes one that had opted out.
 *
 * The tRPC mutation is the entry point for the UI; this is the same write
 * without the request context, so hooks (currently the post-verification
 * subscribe) can call it directly instead of going through `caller`.
 *
 * On a re-subscribe the counters are reset: the address is no longer a campaign
 * recipient, so historical send totals must not carry forward. An existing
 * `userId` link is preserved unless the caller supplies a different one, since
 * an anonymous re-subscribe must not erase an earlier account-bound signup.
 */
export async function subscribeToNewsletter(
  email: string,
  { userId = null, source = 'website', updateSource = false, locale }: SubscribeOptions = {}
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || isSyntheticAddress(normalizedEmail)) {
    return false
  }

  try {
    const now = new Date()
    const [existing] = await db
      .select({ id: newsletterSubscription.id, userId: newsletterSubscription.userId })
      .from(newsletterSubscription)
      .where(eq(newsletterSubscription.email, normalizedEmail))
      .limit(1)

    if (existing) {
      await db
        .update(newsletterSubscription)
        .set({
          subscribed: true,
          subscribedAt: now,
          unsubscribedAt: null,
          ...(userId ? { userId } : {}),
          ...(updateSource ? { source } : {}),
          updatedAt: now,
        })
        .where(eq(newsletterSubscription.id, existing.id))
    } else {
      // This table has no column default for `id`, so the key is minted here
      // rather than by the schema.
      await db.insert(newsletterSubscription).values({
        id: createId(),
        email: normalizedEmail,
        userId,
        subscribed: true,
        source,
        subscribedAt: now,
      })
    }

    // The confirmation mail is a courtesy, not part of the transaction: the
    // subscription is already durable, so a transport failure must not be
    // reported as a failed subscribe.
    if (locale) {
      try {
        await sendEmail({
          to: normalizedEmail,
          template: 'subscribeNewsletter',
          context: { email: normalizedEmail },
          locale,
        })
      } catch (error) {
        console.error('send newsletter confirmation failed:', error)
      }
    }

    return true
  } catch (error) {
    console.error('newsletter subscribe failed:', error)
    return false
  }
}
