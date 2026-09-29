import { randomUUID } from 'crypto'
import type { PaymentProviderDeps } from '../repository'
import * as AlipayUtils from '../utils/alipay-utils'
import {
  AlipayCredentials,
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
  type Price,
  type Subscription,
} from '../types'

/**
 * Alipay payment provider implementation
 *
 * 支付宝支付提供商实现
 * 支持订阅和一次性支付
 */
export class AlipayProvider implements PaymentProvider {
  private appId: string
  private privateKey: string
  private publicKey: string
  private gateway: string
  private notifyUrl: string
  private returnUrl: string
  private deps: PaymentProviderDeps

  /**
   * Initialize Alipay provider with credentials and injected dependencies.
   */
  constructor(credentials: AlipayCredentials, deps: PaymentProviderDeps) {
    this.appId = credentials.appId
    if (!this.appId) {
      throw new Error('AlipayProvider requires an app id')
    }

    this.privateKey = credentials.privateKey
    if (!this.privateKey) {
      throw new Error('AlipayProvider requires a private key')
    }

    this.publicKey = credentials.publicKey
    if (!this.publicKey) {
      throw new Error('AlipayProvider requires a public key')
    }

    this.gateway = credentials.gateway
    this.notifyUrl = credentials.notifyUrl
    this.returnUrl = credentials.returnUrl
    this.deps = {
      repository: deps.repository,
      plans: deps.plans,
      notifier: deps.notifier,
    }
  }

  /**
   * Create a customer in Alipay if not exists
   * @param email Customer email
   * @param name Optional customer name
   * @returns Alipay customer ID (using email as identifier)
   */
  private async createOrGetCustomer(email: string, name?: string): Promise<string> {
    try {
      // 支付宝使用邮箱作为客户标识符
      // 检查数据库中是否已存在该邮箱的用户
      const existingUser = await this.deps.repository.findUserByEmail(email)

      if (existingUser) {
        if (existingUser.customerId) {
          return existingUser.customerId
        }
        // 如果没有customerId，使用邮箱作为标识符
        const customerId = `alipay_${email}`
        await this.updateUserWithCustomerId(customerId, email)
        return customerId
      }

      // 创建新客户标识符
      const customerId = `alipay_${email}`

      // 更新用户记录
      await this.updateUserWithCustomerId(customerId, email)

      return customerId
    } catch (error) {
      console.error('Create or get customer error:', error)
      throw new Error('Failed to create or get customer')
    }
  }

  /**
   * Updates a user record with an Alipay customer ID
   * @param customerId Alipay customer ID
   * @param email Customer email
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
   * @param customerId Alipay customer ID
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
   * Get the provider name
   * @returns Provider name
   */
  public getProviderName(): string {
    return 'alipay'
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
      const price = this.deps.plans.findPriceInPlan(planId, priceId) as Price
      if (!price) {
        throw new Error(`Price ID ${priceId} not found in plan ${planId}`)
      }

      // Get userName from metadata if available
      const userName = metadata?.userName

      // Create or get customer
      const customerId = await this.createOrGetCustomer(customerEmail, userName)

      // 生成支付宝订单号
      const outTradeNo = `alipay_${randomUUID()}`

      // 构建支付宝支付参数
      const alipayParams = {
        app_id: this.appId,
        method: 'alipay.trade.page.pay',
        charset: 'utf-8',
        sign_type: 'RSA2',
        sign: null as string | null,
        timestamp: new Date().toISOString().replace(/[-:]/g, '').split('.')[0],
        version: '1.0',
        notify_url: this.notifyUrl,
        return_url: successUrl || this.returnUrl,
        biz_content: JSON.stringify({
          out_trade_no: outTradeNo,
          product_code: 'FAST_INSTANT_TRADE_PAY',
          total_amount: (price.amount / 100).toFixed(2), // 转换为元
          subject: `${plan.name || planId} - ${price.interval || '一次性'}`,
          body: plan.description || '',
          // 如果是订阅，添加特殊标识
          ...(price.type === PaymentTypes.SUBSCRIPTION && {
            passback_params: JSON.stringify({
              type: 'subscription',
              planId,
              priceId,
              customerId,
              userId: metadata?.userId,
              interval: price.interval,
              trialPeriodDays: price.trialPeriodDays,
            }),
          }),
        }),
      }

      // 添加元数据
      if (metadata) {
        alipayParams.biz_content = JSON.stringify({
          ...JSON.parse(alipayParams.biz_content),
          passback_params: JSON.stringify({
            ...JSON.parse(alipayParams.biz_content || '{}').passback_params,
            ...metadata,
          }),
        })
      }

      // 生成签名
      const sign = this.generateSignature(alipayParams)
      alipayParams.sign = sign

      // 构建支付URL
      const queryString = Object.entries(alipayParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
        .join('&')

      const paymentUrl = `${this.gateway}?${queryString}`

      return {
        url: paymentUrl,
        id: outTradeNo,
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
      // 支付宝没有原生的客户门户，我们重定向到订单查询页面
      // 或者可以创建一个自定义的客户管理页面
      const portalUrl = returnUrl || '/dashboard/settings/billing'

      return {
        url: portalUrl,
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
   * Handle webhook event
   * @param payload Raw webhook payload (JSON string from route handler)
   * @param signature Webhook signature
   */
  public async handleWebhookEvent(payload: string, signature: string): Promise<void> {
    try {
      // 解析JSON payload（从route handler传递过来的）
      const eventData = JSON.parse(payload)
      const eventType = eventData.trade_status

      console.log(`Handle Alipay webhook event, type: ${eventType}`)

      // 验证签名
      if (!this.verifySignature(eventData, signature)) {
        throw new Error('Invalid Alipay webhook signature')
      }

      // 处理支付成功事件
      if (eventType === 'TRADE_SUCCESS' || eventType === 'TRADE_FINISHED') {
        await this.onPaymentSuccess(eventData)
      }
      // 处理支付关闭事件
      else if (eventType === 'TRADE_CLOSED') {
        await this.onPaymentClosed(eventData)
      }
    } catch (error) {
      console.error('Handle webhook event error:', error)
      throw new Error('Failed to handle webhook event')
    }
  }

  /**
   * Handle successful payment
   * @param eventData Alipay webhook event data
   */
  private async onPaymentSuccess(eventData: any): Promise<void> {
    const outTradeNo = eventData.out_trade_no
    const tradeNo = eventData.trade_no
    const buyerId = eventData.buyer_id
    const totalAmount = eventData.total_amount

    console.log(`>> Handle successful payment for order ${outTradeNo}`)

    try {
      // 解析passback_params获取订单信息
      const passbackParams = eventData.passback_params ? AlipayUtils.safeParseJSON(eventData.passback_params, {}) : {}

      const { type, planId, priceId, customerId, userId, interval, trialPeriodDays } = passbackParams as {
        type?: string
        planId?: string
        priceId?: string
        customerId?: string
        userId?: string
        interval?: string
        trialPeriodDays?: number
      }

      if (!userId) {
        console.warn(`<< No userId found for order ${outTradeNo}`)
        return
      }

      // 幂等性检查 - 检查是否已经处理过该订单
      const existingPayment = await this.deps.repository.findPaymentByOrderId(outTradeNo)

      if (existingPayment) {
        console.log(`<< Order ${outTradeNo} already processed, skipping`)
        return
      }

      if (type === PaymentTypes.SUBSCRIPTION) {
        // 处理订阅支付
        await this.onCreateSubscription({
          outTradeNo,
          tradeNo,
          buyerId,
          totalAmount,
          planId,
          priceId,
          customerId,
          userId,
          interval,
          trialPeriodDays,
        })
      } else {
        // 处理一次性支付
        await this.onOneTimePayment({
          outTradeNo,
          tradeNo,
          buyerId,
          totalAmount,
          planId,
          priceId,
          customerId,
          userId,
        })
      }
    } catch (error) {
      console.error('Handle payment success error:', error)
    }
  }

  /**
   * Handle payment closed
   * @param eventData Alipay webhook event data
   */
  private async onPaymentClosed(eventData: any): Promise<void> {
    const outTradeNo = eventData.out_trade_no
    console.log(`>> Handle payment closed for order ${outTradeNo}`)

    // 可以在这里处理支付关闭的逻辑
    // 比如更新订单状态等
  }

  /**
   * Create subscription payment record
   */
  private async onCreateSubscription(paymentData: any): Promise<void> {
    const {
      outTradeNo,
      tradeNo,
      buyerId,
      totalAmount,
      planId,
      priceId,
      customerId,
      userId,
      interval,
      trialPeriodDays,
    } = paymentData

    try {
      const now = new Date()
      let trialStart: Date | undefined
      let trialEnd: Date | undefined

      // 计算试用期
      if (trialPeriodDays && trialPeriodDays > 0) {
        trialStart = now
        trialEnd = new Date(now.getTime() + trialPeriodDays * 24 * 60 * 60 * 1000)
      }

      // 计算订阅周期
      const periodStart = now
      const periodEnd = new Date(now.getTime() + (interval === PlanIntervals.YEAR ? 365 : 30) * 24 * 60 * 60 * 1000)

      const paymentId = await this.deps.repository.createPayment({
          id: randomUUID(),
          priceId,
          type: PaymentTypes.SUBSCRIPTION,
          userId,
          customerId,
          subscriptionId: outTradeNo,
          interval,
          status: 'active',
          periodStart,
          periodEnd,
          cancelAtPeriodEnd: false,
          trialStart,
          trialEnd,
          createdAt: now,
          updatedAt: now,
      })

      if (paymentId) {
        console.log(`<< Created subscription record ${paymentId} for order ${outTradeNo}`)
      }

      // 发送Discord通知
      await this.deps.notifier.purchaseCompleted({
      sessionId: outTradeNo,
      customerId,
      userId,
      amount: totalAmount * 100,
    })
    } catch (error) {
      console.error('Create subscription record error:', error)
    }
  }

  /**
   * Create one-time payment record
   */
  private async onOneTimePayment(paymentData: any): Promise<void> {
    const { outTradeNo, tradeNo, buyerId, totalAmount, planId, priceId, customerId, userId } = paymentData

    try {
      const now = new Date()
      const paymentId = await this.deps.repository.createPayment({
          id: randomUUID(),
          priceId,
          type: PaymentTypes.ONE_TIME,
          userId,
          customerId,
          status: 'completed',
          periodStart: now,
          createdAt: now,
          updatedAt: now,
      })

      if (paymentId) {
        console.log(`<< Created one-time payment record ${paymentId} for order ${outTradeNo}`)
      }

      // 发送Discord通知
      await this.deps.notifier.purchaseCompleted({
      sessionId: outTradeNo,
      customerId,
      userId,
      amount: totalAmount * 100,
    })
    } catch (error) {
      console.error('Create one-time payment record error:', error)
    }
  }

  /**
   * Generate Alipay signature
   * @param params Parameters to sign
   * @returns Generated signature
   */
  private generateSignature(params: Record<string, any>): string {
    return AlipayUtils.generateSignature(params, this.privateKey)
  }

  /**
   * Verify Alipay webhook signature
   * @param eventData Webhook event data
   * @param signature Webhook signature
   * @returns Whether signature is valid
   */
  private verifySignature(eventData: any, signature: string): boolean {
    try {
      return AlipayUtils.verifySignature(eventData, signature, this.publicKey)
    } catch (error) {
      console.error('Signature verification error:', error)
      return false
    }
  }
}
