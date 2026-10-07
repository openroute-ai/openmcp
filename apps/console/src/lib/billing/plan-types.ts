/**
 * 档位、周期、价格的**纯类型与常量**——没有 drizzle、没有 db、没有服务器依赖。
 *
 * 单独一个文件而不是让 `db/schema/billing.ts` 直接暴露它们，是因为这些定义要进
 * 客户端：结算弹窗得知道有哪些周期、每个周期多少钱，而把 `drizzle-orm` 打进落地页
 * 的 bundle 换来两个字符串常量是不划算的。schema 从这里取类型，两边永远同一份。
 */

/** 卖什么。目前只有 Pro——Team / Enterprise 走「联系团队」，不收单。 */
export const SUBSCRIPTION_PLANS = ["pro"] as const
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number]

/** 计费周期。年付的折扣直接写死在价目表里，不存折扣率。 */
export const SUBSCRIPTION_CYCLES = ["monthly", "yearly"] as const
export type SubscriptionCycle = (typeof SUBSCRIPTION_CYCLES)[number]

/** 一个在售档位。`display` 是服务端算好的「¥99.00」，界面不要自己拼金额。 */
export interface PlanPrice {
  plan: SubscriptionPlan
  cycle: SubscriptionCycle
  amountFen: number
  display: string
  /**
   * 生效期内续费价（原价 × `RENEWAL_RATE`）。与 `display` 一对并列的换算值：
   * 续费态弹窗显示折后价，而判定"是不是续费"在服务端按订单时刻的 `activeUntil`
   * 进行，这里只是把折后价也做成一份给界面用。
   */
  renewalAmountFen: number
  renewalDisplay: string
}
