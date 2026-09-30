/**
 * Row shape rendered by the newsletter subscription console.
 *
 * Derived from the tRPC output so the table and the page cannot drift apart.
 */
export type AdminNewsletterSubscriptionRow = {
  id: string
  email: string
  userId: string | null
  subscribed: boolean
  source: string | null
  emailSentCount: number
  lastEmailSentAt: Date | null
  createdAt: Date
  // `subscribed_at` is NOT NULL in the schema; only `unsubscribed_at` can be null.
  subscribedAt: Date
  unsubscribedAt: Date | null
  user: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  } | null
}
