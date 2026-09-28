import { randomUUID } from 'crypto'
import type { PaymentProviderDeps } from '../repository'
import * as WeChatUtils from '../utils/wechat-utils'
import {
  WeChatCredentials,
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
 * WeChat Pay payment provider implementation
 *
 * 微信支付提供商实现
 * 支持订阅和一次性支付
 */
export class WeChatPayProvider implements PaymentProvider {
  private appId: string
  private mchId: string
  private apiKey: string
  private privateKey: string
  private certificatePath: string
  private notifyUrl: string
  private returnUrl: string
  private deps: PaymentProviderDeps

  /**
   * Initialize WeChat Pay provider with credentials and injected dependencies.
   */
  constructor(credentials: WeChatCredentials, deps: PaymentProviderDeps) {
    this.appId = credentials.appId
    if (!this.appId) {
      throw new Error('WeChatPayProvider requires an app id')
    }

    this.mchId = credentials.mchId
    if (!this.mchId) {
      throw new Error('WeChatPayProvider requires a merchant id')
    }

    this.apiKey = credentials.apiKey
    if (!this.apiKey) {
      throw new Error('WeChatPayProvider requires an API key')
    }

    this.privateKey = credentials.privateKey
    if (!this.privateKey) {
      throw new Error('WeChatPayProvider requires a private key')
    }

    this.certificatePath = credentials.certificatePath
    this.notifyUrl = credentials.notifyUrl
    this.returnUrl = credentials.returnUrl
    this.deps = {
      repository: deps.repository,
      plans: deps.plans,
      notifier: deps.notifier,
    }
  }

  /**
   * Create a customer in WeChat Pay if not exists
   * @param email Customer email
   * @param name Optional customer name
   * @returns WeChat Pay customer ID (using email as identifier)
   */
  private async createOrGetCustomer(email: string, name?: string): Promise<string> {
    try {
      // 微信支付使用邮箱作为客户标识符
      // 检查数据库中是否已存在该邮箱的用户
      const existingUser = await this.deps.repository.findUserByEmail(email)

      if (existingUser) {
        if (existingUser.customerId) {
          return existingUser.customerId
        }
        // 如果没有customerId，使用邮箱作为标识符
        const customerId = `wechat_${email}`
        await this.updateUserWithCustomerId(customerId, email)
        return customerId
      }

      // 创建新客户标识符
      const customerId = `wechat_${email}`

      // 更新用户记录
      await this.updateUserWithCustomerId(customerId, email)

      return customerId
    } catch (error) {
      console.error('Create or get customer error:', error)
      throw new Error('Failed to create or get customer')
    }
  }

  /**
   * Updates a user record with a WeChat Pay customer ID
   * @param customerId WeChat Pay customer ID
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
   * @param customerId WeChat Pay customer ID
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
    return 'wechat'
  }

  /**
   * Create a checkout session for a plan
   * @param params Parameters for creating the checkout session
   * @returns Checkout result
   */
  public async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const { planId, priceId, customerEmail, successUrl, cancelUrl, metadata, locale } = params

    try {
      // 验证必要参数
      if (!planId) {
        throw new Error('Plan ID is required')
      }

      if (!priceId) {
        throw new Error('Price ID is required')
      }

      if (!customerEmail) {
        throw new Error('Customer email is required')
      }

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

      // 生成微信支付订单号
      const outTradeNo = `wechat_${randomUUID()}`

      // 构建微信支付参数
      const wechatPayParams = {
        appid: this.appId,
        mch_id: this.mchId,
        sign: null as string | null,
        nonce_str: this.generateNonceStr(),
        body: `${plan.name || planId} - ${price.interval || '一次性'}`,
        out_trade_no: outTradeNo,
        total_fee: price.amount, // 微信支付使用分为单位
        spbill_create_ip: '127.0.0.1', // 实际使用时应该获取真实IP
        notify_url: this.notifyUrl,
        trade_type: 'NATIVE', // 二维码支付
        // 如果是订阅，添加特殊标识
        ...(price.type === PaymentTypes.SUBSCRIPTION && {
          attach: JSON.stringify({
            type: 'subscription',
            planId,
            priceId,
            customerId,
            userId: metadata?.userId,
            interval: price.interval,
            trialPeriodDays: price.trialPeriodDays,
          }),
        }),
      }

      // 添加元数据到attach字段
      if (metadata && wechatPayParams.attach) {
        try {
          const attachData = JSON.parse(wechatPayParams.attach)
          wechatPayParams.attach = JSON.stringify({
            ...attachData,
            ...metadata,
          })
        } catch (error) {
          console.warn('Failed to parse attach data, using metadata only:', error)
          wechatPayParams.attach = JSON.stringify(metadata)
        }
      } else if (metadata) {
        wechatPayParams.attach = JSON.stringify(metadata)
      }

      // 生成签名
      const sign = this.generateSignature(wechatPayParams)
      wechatPayParams.sign = sign as string

      // 调用微信支付统一下单API
      const paymentUrl = await this.createUnifiedOrder(wechatPayParams)

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
      // 验证必要参数
      if (!customerId) {
        throw new Error('Customer ID is required')
      }

      // 微信支付没有原生的客户门户，我们重定向到订单查询页面
      // 或者可以创建一个自定义的客户管理页面
      const portalUrl = returnUrl || '/dashboard/settings/billing'

      return {
        url: portalUrl,
      }
    } catch (error) {
      console.error('Create customer portal error:', error)
      throw new Error(`Failed to create customer portal: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      // 验证输入参数
      if (!payload || !signature) {
        throw new Error('Missing required parameters: payload and signature')
      }

      // 解析JSON payload（从route handler传递过来的）
      let eventData: any
      try {
        eventData = JSON.parse(payload)
      } catch (parseError) {
        throw new Error(`Invalid JSON payload: ${parseError}`)
      }

      const eventType = eventData.result_code
      const outTradeNo = eventData.out_trade_no

      console.log(`Handle WeChat Pay webhook event, type: ${eventType}, order: ${outTradeNo}`)

      // 验证必要字段
      if (!eventType) {
        throw new Error('Missing result_code in webhook payload')
      }

      if (!outTradeNo) {
        throw new Error('Missing out_trade_no in webhook payload')
      }

      // 验证签名
      if (!this.verifySignature(eventData, signature)) {
        throw new Error('Invalid WeChat Pay webhook signature')
      }

      // 处理支付成功事件
      if (eventType === 'SUCCESS') {
        await this.onPaymentSuccess(eventData)
      }
      // 处理支付失败事件
      else if (eventType === 'FAIL') {
        await this.onPaymentFailed(eventData)
      } else {
        console.warn(`Unhandled event type: ${eventType} for order: ${outTradeNo}`)
      }
    } catch (error) {
      console.error('Handle webhook event error:', error)
      throw new Error(`Failed to handle webhook event: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Handle successful payment
   * @param eventData WeChat Pay webhook event data
   */
  private async onPaymentSuccess(eventData: any): Promise<void> {
    const outTradeNo = eventData.out_trade_no
    const transactionId = eventData.transaction_id
    const totalFee = eventData.total_fee

    console.log(`>> Handle successful payment for order ${outTradeNo}`)

    try {
      // 验证必要字段
      if (!outTradeNo) {
        throw new Error('Missing out_trade_no in payment success event')
      }

      if (!transactionId) {
        console.warn(`Missing transaction_id for order ${outTradeNo}`)
      }

      if (!totalFee) {
        console.warn(`Missing total_fee for order ${outTradeNo}`)
      }

      // 解析attach字段获取订单信息
      const attachData = eventData.attach ? WeChatUtils.safeParseJSON(eventData.attach, {} as any) : ({} as any)

      const { type, planId, priceId, customerId, userId, interval, trialPeriodDays } = attachData

      if (!userId) {
        console.warn(`<< No userId found for order ${outTradeNo}`)
        return
      }

      if (!type) {
        console.warn(`<< No payment type found for order ${outTradeNo}, defaulting to one-time payment`)
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
          transactionId,
          totalFee,
          planId,
          priceId,
          customerId,
          userId,
          interval,
          trialPeriodDays,
        })
      } else {
        // 处理一次性支付（包括未指定类型的情况）
        await this.onOneTimePayment({
          outTradeNo,
          transactionId,
          totalFee,
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
   * Handle payment failed
   * @param eventData WeChat Pay webhook event data
   */
  private async onPaymentFailed(eventData: any): Promise<void> {
    const outTradeNo = eventData.out_trade_no
    const errCode = eventData.err_code
    const errCodeDes = eventData.err_code_des

    console.log(`>> Handle payment failed for order ${outTradeNo}, error: ${errCode} - ${errCodeDes}`)

    try {
      // 验证必要字段
      if (!outTradeNo) {
        console.warn('Missing out_trade_no in payment failed event')
        return
      }

      // 可以在这里处理支付失败的逻辑
      // 比如更新订单状态、发送通知等
      console.log(`Payment failed for order ${outTradeNo}: ${errCode} - ${errCodeDes}`)

      // TODO: 实现支付失败后的业务逻辑
      // 例如：更新订单状态为失败、发送失败通知等
    } catch (error) {
      console.error('Handle payment failed error:', error)
    }
  }

  /**
   * Create subscription payment record
   */
  private async onCreateSubscription(paymentData: any): Promise<void> {
    const { outTradeNo, transactionId, totalFee, planId, priceId, customerId, userId, interval, trialPeriodDays } =
      paymentData

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
      amount: totalFee,
    })
    } catch (error) {
      console.error('Create subscription record error:', error)
    }
  }

  /**
   * Create one-time payment record
   */
  private async onOneTimePayment(paymentData: any): Promise<void> {
    const { outTradeNo, transactionId, totalFee, planId, priceId, customerId, userId } = paymentData

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
      amount: totalFee,
    })
    } catch (error) {
      console.error('Create one-time payment record error:', error)
    }
  }

  /**
   * Generate nonce string for WeChat Pay
   * @returns Random nonce string
   */
  private generateNonceStr(): string {
    return WeChatUtils.generateNonceStr(15)
  }

  /**
   * Generate WeChat Pay signature
   * @param params Parameters to sign
   * @returns Generated signature
   */
  private generateSignature(params: Record<string, any>): string {
    return WeChatUtils.generateSignature(params, this.apiKey)
  }

  /**
   * Verify WeChat Pay webhook signature
   * @param eventData Webhook event data
   * @param signature Webhook signature
   * @returns Whether signature is valid
   */
  private verifySignature(eventData: any, signature: string): boolean {
    try {
      return WeChatUtils.verifySignature(eventData, signature, this.apiKey)
    } catch (error) {
      console.error('Signature verification error:', error)
      return false
    }
  }

  /**
   * Create unified order with WeChat Pay
   * @param params Order parameters
   * @returns Payment URL (QR code URL)
   */
  private async createUnifiedOrder(params: Record<string, any>): Promise<string> {
    // 这里应该实现调用微信支付统一下单API
    // 为了简化，这里返回一个占位符URL
    // 实际使用时需要实现完整的微信支付API调用
    console.warn('Unified order creation not implemented - implement WeChat Pay API call in production')

    // 返回一个示例二维码URL
    return `weixin://wxpay/bizpayurl?pr=${params.out_trade_no}`
  }

  /**
   * Parse XML response from WeChat Pay
   * @param xml XML string
   * @returns Parsed object
   */
  private async parseXML(xml: string): Promise<Record<string, any>> {
    return WeChatUtils.parseXML(xml)
  }
}
