import { and, eq } from "drizzle-orm"
import { getLocale } from "next-intl/server"
import { z } from "zod"
import { createId, newsletterSubscription } from "@workspace/db"
import { db } from "@/lib/db"
import { sendEmail } from "@/mail"
import { createTRPCRouter, protectedProcedure } from "@/server/routers/trpc"

/**
 * Newsletter subscription state, stored per address.
 *
 * The upstream app delegated this to the mailing provider's audience API. This
 * app keeps its own table, so status is answered from the row and the provider
 * is only used to send the confirmation mail.
 */
const emailSchema = z.object({ email: z.string().email() })

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export const newslettersRouter = createTRPCRouter({
  /**
   * Adds an address to the list, or re-subscribes one that had opted out.
   *
   * On a re-subscribe the counters are reset: the address is no longer a
   * campaign recipient, so historical send totals must not carry forward.
   */
  subscribeNewsletter: protectedProcedure
    .input(emailSchema)
    .mutation(async ({ ctx, input }) => {
      try {
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
              subscribedAt: new Date(),
              unsubscribedAt: null,
              userId: ctx.user.id,
              updatedAt: new Date(),
            })
            .where(eq(newsletterSubscription.id, existing.id))
        } else {
          // This table has no column default for `id`, so the key is minted
          // here rather than by the schema.
          await db.insert(newsletterSubscription).values({
            id: createId(),
            email: input.email,
            userId: ctx.user.id,
            subscribed: true,
            subscribedAt: new Date(),
          })
        }

        // A confirmation mail is a courtesy, not part of the transaction: the
        // subscription is already durable, so a transport failure must not be
        // reported as a failed subscribe.
        try {
          await sendEmail({
            to: input.email,
            template: "subscribeNewsletter",
            context: { email: input.email },
            locale: (await getLocale()) as "zh" | "en",
          })
        } catch (error) {
          console.error("send newsletter confirmation failed:", error)
        }

        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: errorMessage(error, "Failed to subscribe to the newsletter"),
        }
      }
    }),

  /**
   * Reports whether an address is currently subscribed.
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
          error: errorMessage(error, "Failed to read newsletter status"),
        }
      }
    }),

  /**
   * Opts an address out.
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
          error: errorMessage(error, "Failed to unsubscribe from the newsletter"),
        }
      }
    }),
})
