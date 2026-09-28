import { randomUUID } from 'crypto'
import { Stripe } from 'stripe'
import type { PaymentProviderDeps } from '../repository'
import {
  type CheckoutResult,
  type CreateCheckoutParams,
  type CreatePortalParams,
  type getSubscriptionsParams,
  type PaymentProvider,
  type PaymentStatus,
  PaymentTypes,
  type PlanInterval,
  PlanIntervals,
  type PortalResult,
  type Subscription,
} from '../types'

/**
 * Stripe payment provider implementation
 *
 * docs:
 * https://openroute.cn/docs/payment
 */
export class StripeProvider implements PaymentProvider {
  private stripe: Stripe
  private webhookSecret: string
  private deps: PaymentProviderDeps

  /**
   * Initialize Stripe provider with credentials and injected dependencies.
   */
  constructor(options: { apiKey: string; webhookSecret: string } & PaymentProviderDeps) {
    if (!options.apiKey) {
      throw new Error('StripeProvider requires an API key')
    }
    if (!options.webhookSecret) {
      throw new Error('StripeProvider requires a webhook secret')
    }

    // Initialize Stripe without specifying apiVersion to use default/latest version
    this.stripe = new Stripe(options.apiKey)
    this.webhookSecret = options.webhookSecret
    this.deps = {
      repository: options.repository,
      plans: options.plans,
      notifier: options.notifier,
    }
  }

  /**
   * Get the provider name
   * @returns Provider name
   */
  public getProviderName(): string {
    return 'stripe'
  }

  /**
   * Create a customer in Stripe if not exists
   * @param email Customer email
   * @param name Optional customer name
   * @returns Stripe customer ID
   */
  private async createOrGetCustomer(email: string, name?: string): Promise<string> {
    try {
      // Search for existing customer
      const customers = await this.stripe.customers.list({
        email,
        limit: 1,
      })

      // Find existing customer
      if (customers.data && customers.data.length > 0) {
        const customerId = customers.data[0]?.id

        if (customerId) {
          // Find user id by customer id
          const userId = await this.findUserIdByCustomerId(customerId)
          // user does not exist, update user with customer id
          // in case you deleted user in database, but forgot to delete customer in Stripe
          if (!userId) {
            console.log(`User ${email} does not exist, update with customer id ${customerId}`)
            await this.updateUserWithCustomerId(customerId, email)
          }
          return customerId
        }
      }

      // Create new customer
      const customer = await this.stripe.customers.create({
        email,
        name: name || undefined,
      })

      // Update user record in database with the new customer ID
      await this.updateUserWithCustomerId(customer.id, email)

      return customer.id
    } catch (error) {
      console.error('Create or get customer error:', error)
      throw new Error('Failed to create or get customer')
    }
  }

  /**
   * Updates a user record with a Stripe customer ID
   * @param customerId Stripe customer ID
   * @param email Customer email
   * @returns Promise that resolves when the update is complete
   */
  private async updateUserWithCustomerId(customerId: string, email: string): Promise<void> {
    try {
      await this.deps.repository.attachCustomerIdToUser(email, customerId)
    } catch (error) {
      console.error('Update user with customer ID error:', error)
      throw new Error('Failed to update user with customer ID')
    }
  }

  /**
   * Finds a user by customerId
   * @param customerId Stripe customer ID
   * @returns User ID or undefined if not found
   */
  private async findUserIdByCustomerId(customerId: string): Promise<string | undefined> {
    try {
      return await this.deps.repository.findUserIdByCustomerId(customerId)
    } catch (error) {
      console.error('Find user by customer ID error:', error)
      return undefined
    }
  }

  /**
   * Create a checkout session for a plan
   * @param params Parameters for creating the checkout session
   * @returns Checkout result
   */
  public async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const { planId, priceId, customerEmail, successUrl, cancelUrl, metadata, locale } = params

    try {
      // Get plan and price
      const plan = this.deps.plans.findPlanByPlanId(planId)
      if (!plan) {
        throw new Error(`Plan with ID ${planId} not found`)
      }

      // Find price in plan
      const price = this.deps.plans.findPriceInPlan(planId, priceId)
      if (!price) {
        throw new Error(`Price ID ${priceId} not found in plan ${planId}`)
      }

      // Get userName from metadata if available
      const userName = metadata?.userName

      // Create or get customer
      const customerId = await this.createOrGetCustomer(customerEmail, userName)

      // Add planId and priceId to metadata, so we can get it in the webhook event
      const customMetadata = {
        ...metadata,
        planId,
        priceId,
      }

      // Set up the line items
      const lineItems = [
        {
          price: priceId,
          quantity: 1,
        },
      ]

      // Create checkout session parameters
      const checkoutParams: Stripe.Checkout.SessionCreateParams = {
        line_items: lineItems,
        mode: price.type === PaymentTypes.SUBSCRIPTION ? 'subscription' : 'payment',
        success_url: successUrl ?? '',
        cancel_url: cancelUrl ?? '',
        metadata: customMetadata,
      }

      // Add customer to checkout session
      checkoutParams.customer = customerId

      // Add locale if provided
      if (locale) {
        checkoutParams.locale = this.mapLocaleToStripeLocale(locale) as Stripe.Checkout.SessionCreateParams.Locale
      }

      // Add payment intent data for one-time payments
      if (price.type === PaymentTypes.ONE_TIME) {
        checkoutParams.payment_intent_data = {
          metadata: customMetadata,
        }
        // Automatically create an invoice for the one-time payment
        checkoutParams.invoice_creation = {
          enabled: true,
        }
      }

      // Add subscription data for recurring payments
      if (price.type === PaymentTypes.SUBSCRIPTION) {
        // Initialize subscription_data with metadata
        checkoutParams.subscription_data = {
          metadata: customMetadata,
        }

        // Add trial period if applicable
        if (price.trialPeriodDays && price.trialPeriodDays > 0) {
          checkoutParams.subscription_data.trial_period_days = price.trialPeriodDays
        }
      }

      // Create the checkout session
      const session = await this.stripe.checkout.sessions.create(checkoutParams)

      return {
        url: session.url!,
        id: session.id,
      }
    } catch (error) {
      console.error('Create checkout session error:', error)
      throw new Error('Failed to create checkout session')
    }
  }

  /**
   * Create a customer portal session
   * @param params Parameters for creating the portal
   * @returns Portal result
   */
  public async createCustomerPortal(params: CreatePortalParams): Promise<PortalResult> {
    const { customerId, returnUrl, locale } = params

    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl ?? '',
        locale: locale
          ? (this.mapLocaleToStripeLocale(locale) as Stripe.BillingPortal.SessionCreateParams.Locale)
          : undefined,
      })

      return {
        url: session.url,
      }
    } catch (error) {
      console.error('Create customer portal error:', error)
      throw new Error('Failed to create customer portal')
    }
  }

  /**
   * Get subscriptions
   * @param params Parameters for getting subscriptions
   * @returns Array of subscription objects
   */
  public async getSubscriptions(params: getSubscriptionsParams): Promise<Subscription[]> {
    const { userId } = params

    try {
      // Newest first, matching the previous `orderBy(createdAt desc)` query
      const payments = await this.deps.repository.listPaymentsByUserId(userId)

      return payments.map((record) => this.deps.repository.toSubscription(record))
    } catch (error) {
      console.error('List customer subscriptions error:', error)
      return []
    }
  }

  /**
   * Handle webhook events
   * @param payload Raw request body
   * @param signature Stripe signature header
   */
  public async handleWebhookEvent(payload: string, signature: string): Promise<void> {
    try {
      const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret)
      const eventType = event.type
      console.log(`handle webhook event, type: ${eventType}`)

      // Handle subscription events
      if (eventType.startsWith('customer.subscription.')) {
        const stripeSubscription = event.data.object as Stripe.Subscription

        // Process based on subscription status and event type
        switch (eventType) {
          case 'customer.subscription.created': {
            await this.onCreateSubscription(stripeSubscription)
            break
          }
          case 'customer.subscription.updated': {
            await this.onUpdateSubscription(stripeSubscription)
            break
          }
          case 'customer.subscription.deleted': {
            await this.onDeleteSubscription(stripeSubscription)
            break
          }
        }
      } else if (eventType.startsWith('checkout.')) {
        // Handle checkout events
        if (eventType === 'checkout.session.completed') {
          const session = event.data.object as Stripe.Checkout.Session

          // Only process one-time payments (likely for lifetime plan)
          if (session.mode === 'payment') {
            await this.onOnetimePayment(session)
          }
        }
      }
    } catch (error) {
      console.error('handle webhook event error:', error)
      throw new Error('Failed to handle webhook event')
    }
  }

  /**
   * Create payment record
   * @param stripeSubscription Stripe subscription
   */
  private async onCreateSubscription(stripeSubscription: Stripe.Subscription): Promise<void> {
    console.log(`>> Create payment record for Stripe subscription ${stripeSubscription.id}`)
    const customerId = stripeSubscription.customer as string

    // get priceId from subscription items (this is always available)
    const priceId = stripeSubscription.items.data[0]?.price.id
    if (!priceId) {
      console.warn(`<< No priceId found for subscription ${stripeSubscription.id}`)
      return
    }

    // get userId from metadata, we add it in the createCheckout session
    const userId = stripeSubscription.metadata.userId
    if (!userId) {
      console.warn(`<< No userId found for subscription ${stripeSubscription.id}`)
      return
    }

    // create fields
    const currentPeriodStart = stripeSubscription.items.data[0]?.current_period_start
    const currentPeriodEnd = stripeSubscription.items.data[0]?.current_period_end
    const createFields: any = {
      id: randomUUID(),
      priceId: priceId,
      type: PaymentTypes.SUBSCRIPTION,
      userId: userId,
      customerId: customerId,
      subscriptionId: stripeSubscription.id,
      interval: this.mapStripeIntervalToPlanInterval(stripeSubscription),
      status: this.mapSubscriptionStatusToPaymentStatus(stripeSubscription.status),
      periodStart: currentPeriodStart ? new Date(currentPeriodStart * 1000) : null,
      periodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
      trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const paymentId = await this.deps.repository.createPayment(createFields)

    if (paymentId) {
      console.log(`<< Created new payment record ${paymentId} for Stripe subscription ${stripeSubscription.id}`)
    } else {
      console.warn(`<< No payment record created for Stripe subscription ${stripeSubscription.id}`)
    }
  }

  /**
   * Update payment record
   * @param stripeSubscription Stripe subscription
   */
  private async onUpdateSubscription(stripeSubscription: Stripe.Subscription): Promise<void> {
    console.log(`>> Update payment record for Stripe subscription ${stripeSubscription.id}`)

    // get priceId from subscription items (this is always available)
    const priceId = stripeSubscription.items.data[0]?.price.id
    if (!priceId) {
      console.warn(`<< No priceId found for subscription ${stripeSubscription.id}`)
      return
    }

    // update fields
    const currentPeriodStart = stripeSubscription.items.data[0]?.current_period_start
    const currentPeriodEnd = stripeSubscription.items.data[0]?.current_period_end
    const updateFields: any = {
      priceId: priceId,
      interval: this.mapStripeIntervalToPlanInterval(stripeSubscription),
      status: this.mapSubscriptionStatusToPaymentStatus(stripeSubscription.status),
      periodStart: currentPeriodStart ? new Date(currentPeriodStart * 1000) : undefined,
      periodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : undefined,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      trialStart: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : undefined,
      trialEnd: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : undefined,
      updatedAt: new Date(),
    }

    const updatedId = await this.deps.repository.updatePaymentBySubscriptionId(
      stripeSubscription.id,
      updateFields
    )

    if (updatedId) {
      console.log(`<< Updated payment record ${updatedId} for Stripe subscription ${stripeSubscription.id}`)
    } else {
      console.warn(`<< No payment record found for Stripe subscription ${stripeSubscription.id}`)
    }
  }

  /**
   * Update payment record, set status to canceled
   * @param stripeSubscription Stripe subscription
   */
  private async onDeleteSubscription(stripeSubscription: Stripe.Subscription): Promise<void> {
    console.log(`>> Mark payment record for Stripe subscription ${stripeSubscription.id} as canceled`)
    const canceledId = await this.deps.repository.updatePaymentBySubscriptionId(
      stripeSubscription.id,
      {
        status: this.mapSubscriptionStatusToPaymentStatus(stripeSubscription.status),
        updatedAt: new Date(),
      }
    )

    if (canceledId) {
      console.log(`<< Marked payment record for subscription ${stripeSubscription.id} as canceled`)
    } else {
      console.warn(`<< No payment record found to cancel for subscription ${stripeSubscription.id}`)
    }
  }

  /**
   * Handle one-time payment
   * @param session Stripe checkout session
   */
  private async onOnetimePayment(session: Stripe.Checkout.Session): Promise<void> {
    const customerId = session.customer as string
    console.log(`>> Handle onetime payment for customer ${customerId}`)

    // get userId from session metadata, we add it in the createCheckout session
    const userId = session.metadata?.userId
    if (!userId) {
      console.warn(`<< No userId found for checkout session ${session.id}`)
      return
    }

    // get priceId from session metadata, not from line items
    // const priceId = session.line_items?.data[0]?.price?.id;
    const priceId = session.metadata?.priceId
    if (!priceId) {
      console.warn(`<< No priceId found for checkout session ${session.id}`)
      return
    }

    // Create a one-time payment record
    const now = new Date()
    const paymentId = await this.deps.repository.createPayment(
      {
        id: randomUUID(),
        priceId: priceId,
        type: PaymentTypes.ONE_TIME,
        userId: userId,
        customerId: customerId,
        status: 'completed', // One-time payments are always completed
        periodStart: now,
        createdAt: now,
        updatedAt: now,
      }
    )

    if (!paymentId) {
      console.warn(`<< Failed to create one-time payment record for user ${userId}`)
      return
    }
    console.log(`<< Created one-time payment record for user ${userId}, price: ${priceId}`)

    // Send message to Discord channel
    const amount = session.amount_total ? session.amount_total / 100 : 0
    await this.deps.notifier.purchaseCompleted({
      sessionId: session.id,
      customerId,
      userId,
      amount,
    })
  }

  /**
   * Map Stripe subscription interval to our own interval types
   * @param subscription Stripe subscription
   * @returns PlanInterval
   */
  private mapStripeIntervalToPlanInterval(subscription: Stripe.Subscription): PlanInterval {
    switch (subscription.items.data[0]?.plan.interval) {
      case 'month':
        return PlanIntervals.MONTH
      case 'year':
        return PlanIntervals.YEAR
      default:
        return PlanIntervals.MONTH
    }
  }

  /**
   * Convert Stripe subscription status to PaymentStatus,
   * we narrow down the status to our own status types
   * @param status Stripe subscription status
   * @returns PaymentStatus
   */
  private mapSubscriptionStatusToPaymentStatus(status: Stripe.Subscription.Status): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      active: 'active',
      canceled: 'canceled',
      incomplete: 'incomplete',
      incomplete_expired: 'incomplete_expired',
      past_due: 'past_due',
      trialing: 'trialing',
      unpaid: 'unpaid',
      paused: 'paused',
    }

    return statusMap[status] || 'failed'
  }

  /**
   * Map application locale to Stripe's supported locales
   * @param locale Application locale (e.g., 'en', 'zh-CN')
   * @returns Stripe locale string
   */
  private mapLocaleToStripeLocale(locale: string | undefined): string {
    if (!locale) {
      return 'auto'
    }

    // Stripe supported locales as of 2023:
    // https://stripe.com/docs/js/appendix/supported_locales
    const stripeLocales = [
      'bg',
      'cs',
      'da',
      'de',
      'el',
      'en',
      'es',
      'et',
      'fi',
      'fil',
      'fr',
      'hr',
      'hu',
      'id',
      'it',
      'ja',
      'ko',
      'lt',
      'lv',
      'ms',
      'mt',
      'nb',
      'nl',
      'pl',
      'pt',
      'ro',
      'ru',
      'sk',
      'sl',
      'sv',
      'th',
      'tr',
      'vi',
      'zh',
    ]

    // First check if the exact locale is supported
    if (stripeLocales.includes(locale)) {
      return locale
    }

    // If not, try to get the base language
    const baseLocale = locale.split('-')[0]
    if (baseLocale && stripeLocales.includes(baseLocale)) {
      return baseLocale
    }

    // Default to auto to let Stripe detect the language
    return 'auto'
  }
}
