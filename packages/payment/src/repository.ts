import type {
  PaymentStatus,
  PaymentType,
  PlanInterval,
  Price,
  PricePlan,
  Subscription,
} from './types'

/**
 * A payment record as the package needs to read and write it.
 *
 * Mirrors the columns of the `payment` table but stays free of Drizzle types so
 * the package does not depend on the host's schema.
 */
export interface PaymentRecord {
  id: string
  priceId: string
  type: PaymentType
  interval?: PlanInterval | null
  userId: string
  customerId: string
  subscriptionId?: string | null
  status: PaymentStatus
  periodStart?: Date | null
  periodEnd?: Date | null
  cancelAtPeriodEnd?: boolean | null
  trialStart?: Date | null
  trialEnd?: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Fields accepted when creating a payment record.
 *
 * `id` is optional: implementations may generate one.
 */
export type CreatePaymentRecord = Omit<PaymentRecord, 'id'> & { id?: string }

/**
 * Persistence seam for the payment package.
 *
 * Every provider routes its reads and writes through this interface, so the
 * package has no Drizzle (or database) dependency. The host app implements it
 * against its own schema — see `apps/web/src/lib/payment-repository.ts`.
 */
export interface PaymentRepository {
  /**
   * Finds a user by the payment provider's customer id.
   *
   * Returns `undefined` when no user is linked, which providers treat as
   * "cannot attribute this event" rather than an error.
   */
  findUserIdByCustomerId(customerId: string): Promise<string | undefined>

  /**
   * Attaches a provider customer id to the user with this email.
   *
   * No-op when the email is unknown.
   */
  attachCustomerIdToUser(email: string, customerId: string): Promise<void>

  /**
   * Finds a user by email, returning the provider customer id already attached
   * to them, if any.
   *
   * The Alipay and WeChat providers key customers off the email address, so
   * they need to read back an existing linkage before minting a new one.
   */
  findUserByEmail(email: string): Promise<{ id: string; customerId?: string | null } | undefined>

  /** Inserts a payment record and returns its id. */
  createPayment(record: CreatePaymentRecord): Promise<string | undefined>

  /**
   * Updates the payment row for a subscription, matched by the provider's
   * subscription id. Returns the payment id when a row was updated.
   */
  updatePaymentBySubscriptionId(
    subscriptionId: string,
    changes: Partial<PaymentRecord>
  ): Promise<string | undefined>

  /**
   * Lists a user's payment records, newest first.
   */
  listPaymentsByUserId(userId: string): Promise<PaymentRecord[]>

  /**
   * Finds a payment record by the provider's order/subscription id.
   *
   * Used for webhook idempotency: a notify that has already been recorded must
   * not be applied twice.
   */
  findPaymentByOrderId(orderId: string): Promise<PaymentRecord | undefined>

  /** Maps stored payment rows onto the package's `Subscription` shape. */
  toSubscription(record: PaymentRecord): Subscription
}

/**
 * Plan catalogue lookup.
 *
 * Price ids and amounts are an application concern: the provider needs a price
 * to charge but must not own the pricing table.
 */
export interface PlanLookup {
  findPlanByPlanId(planId: string): PricePlan | undefined
  findPriceInPlan(planId: string, priceId: string): Price | undefined
}

/**
 * Operational notifications emitted by payment flows (Discord, email, ...).
 *
 * Implementations should not throw: a failed notification must not fail the
 * payment that triggered it.
 */
export interface PaymentNotifier {
  /**
   * Reports a completed one-time purchase.
   */
  purchaseCompleted(params: {
    sessionId: string
    customerId: string
    userId: string
    amount: number
  }): Promise<void>
}

/**
 * The dependencies every provider is constructed with.
 */
export interface PaymentProviderDeps {
  repository: PaymentRepository
  plans: PlanLookup
  notifier: PaymentNotifier
}
