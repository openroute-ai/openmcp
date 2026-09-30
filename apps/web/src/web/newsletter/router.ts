import { and, eq } from 'drizzle-orm'
import { getLocale } from 'next-intl/server'
import { z } from 'zod'
import { createId, newsletterSubscription } from '@workspace/db'
import { db } from '@/lib/db'
import { sendEmail } from '@/mail'
import { createTRPCRouter, protectedProcedure, publicProcedure } from '@/server/routers/trpc'

/**
 * Newsletter subscription state, stored per address.
 *
 * The upstream app delegated this to the mailing provider's audience API. This
 * app keeps its own table, so status is answered from the row and the provider
 * is only used to send the confirmation mail.
 */
const emailSchema = z.object({ email: z.string().email() })

/**
 * Public signup shape.
 *
 * Attribution is accepted verbatim from the marketing form because it is the
 * only record of where a subscriber came from. Everything is optional and
 * length-capped: these columns end up in mail URLs, and an uncapped value from
 * a public endpoint is a stored-XSS vector wherever a campaign links to.
 */
const publicSubscribeSchema = emailSchema.extend({
  source: z.string().max(64).optional(),
  utmSource: z.string().max(128).optional(),
  utmMedium: z.string().max(128).optional(),
  utmCampaign: z.string().max(128).optional(),
  utmTerm: z.string().max(128).optional(),
  utmContent: z.string().max(128).optional(),
  referrer: z.string().max(512).optional(),
})

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export const newslettersRouter = createTRPCRouter({
  /**
   * Adds an address to the list, or re-subscribes one that had opted out.
   *
   * Open to anonymous visitors, since the marketing pages carry the signup form
   * and gating it behind an account loses every visitor who has not signed up
   * yet. A session is used when present only to link the row to a user; the
   * address is the identity either way.
   *
   * On a re-subscribe the counters are reset: the address is no longer a
   * campaign recipient, so historical send totals must not carry forward.
   */
  subscribeNewsletter: publicProcedure
    .input(publicSubscribeSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.user?.id ?? null
        const now = new Date()

        const [existing] = await db
          .select({ id: newsletterSubscription.id })
          .from(newsletterSubscription)
          .where(eq(newsletterSubscription.email, input.email))
          .limit(1)

        if (existing) {
          await db
            .update(newsletterSubscription)
            .set({
              subscribed: true,
              subscribedAt: now,
              unsubscribedAt: null,
              // Every optional field below is applied only when the caller
              // actually supplied it. Two reasons not to blanket-overwrite:
              // a re-subscribe from the settings toggle carries no attribution
              // and would otherwise wipe the original campaign data, and a
              // signed-out visitor must not erase the `userId` link that an
              // earlier account-bound signup established.
              ...(userId ? { userId } : {}),
              ...(input.source ? { source: input.source } : {}),
              ...(input.utmSource ? { utmSource: input.utmSource } : {}),
              ...(input.utmMedium ? { utmMedium: input.utmMedium } : {}),
              ...(input.utmCampaign ? { utmCampaign: input.utmCampaign } : {}),
              ...(input.utmTerm ? { utmTerm: input.utmTerm } : {}),
              ...(input.utmContent ? { utmContent: input.utmContent } : {}),
              ...(input.referrer ? { referrer: input.referrer } : {}),
              updatedAt: now,
            })
            .where(eq(newsletterSubscription.id, existing.id))
        } else {
          // This table has no column default for `id`, so the key is minted
          // here rather than by the schema.
          await db.insert(newsletterSubscription).values({
            id: createId(),
            email: input.email,
            userId,
            subscribed: true,
            source: input.source ?? 'website',
            utmSource: input.utmSource ?? null,
            utmMedium: input.utmMedium ?? null,
            utmCampaign: input.utmCampaign ?? null,
            utmTerm: input.utmTerm ?? null,
            utmContent: input.utmContent ?? null,
            referrer: input.referrer ?? null,
            subscribedAt: now,
          })
        }

        // A confirmation mail is a courtesy, not part of the transaction: the
        // subscription is already durable, so a transport failure must not be
        // reported as a failed subscribe.
        try {
          await sendEmail({
            to: input.email,
            template: 'subscribeNewsletter',
            context: { email: input.email },
            locale: (await getLocale()) as 'zh' | 'en',
          })
        } catch (error) {
          console.error('send newsletter confirmation failed:', error)
        }

        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: errorMessage(error, 'Failed to subscribe to the newsletter'),
        }
      }
    }),

  /**
   * Reports whether an address is currently subscribed.
   *
   * Deliberately not public: an open "is this address on the list" endpoint is
   * a membership oracle for any address the caller guesses. The public signup
   * form therefore only ever subscribes and never reads.
   *
   * An unknown address reads as unsubscribed rather than as an error, so the
   * settings card can render a default state without special-casing misses.
   */
  checkNewsletterStatus: protectedProcedure
    .input(emailSchema)
    .mutation(async ({ input }) => {
      try {
        const [row] = await db
          .select({ subscribed: newsletterSubscription.subscribed })
          .from(newsletterSubscription)
          .where(eq(newsletterSubscription.email, input.email))
          .limit(1)

        return { success: true as const, subscribed: row?.subscribed ?? false }
      } catch (error) {
        return {
          success: false as const,
          subscribed: false,
          error: errorMessage(error, 'Failed to read newsletter status'),
        }
      }
    }),

  /**
   * Opts an address out.
   *
   * Stays behind a session for the same reason the status read does. Campaign
   * mails carry their own provider-side unsubscribe link, so the public path
   * does not need to expose this.
   *
   * The row is kept rather than deleted so the opt-out is auditable and a
   * later subscribe can distinguish "never subscribed" from "left".
   */
  unsubscribeNewsletter: protectedProcedure
    .input(emailSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        await db
          .update(newsletterSubscription)
          .set({
            subscribed: false,
            unsubscribedAt: new Date(),
            userId: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(newsletterSubscription.email, input.email),
              eq(newsletterSubscription.subscribed, true)
            )
          )

        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: errorMessage(error, 'Failed to unsubscribe from the newsletter'),
        }
      }
    }),
})
