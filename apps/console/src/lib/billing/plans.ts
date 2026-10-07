/**
 * 卖什么、卖多少钱、订单号怎么生成。
 *
 * 价格是**服务端的常量**，不是数据库里的行，也不是客户端传上来的数字：一份价目表
 * 一年改不了几次，而把它做成可配置的就会出现"运营改了价、老订单按新价结算"这种
 * 需要审计才能解释的问题。客户端要显示价格时读 `billing.checkoutConfig`，拿到的是
 * 这里算出来的同一份。
 *
 * 金额单位一律是**分**（整数）。`¥99 × 12 × 0.8 = ¥950.40` 在浮点里是
 * `950.3999999999999`，写成 `95040` 就没有这个问题。
 */
import {
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_PLANS,
  type PlanPrice,
  type SubscriptionCycle,
  type SubscriptionPlan,
} from "@/lib/billing/plan-types"

/** Pro 的价目表，分。月付 ¥99，年付 8 折（¥99 × 12 × 0.8 = ¥950.40）。 */
const PRICES_FEN: Record<SubscriptionPlan, Record<SubscriptionCycle, number>> = {
  pro: {
    monthly: 9_900,
    yearly: 95_040,
  },
}

/**
 * 生效期内续费折扣：续费价 = 原价 × 0.8。
 *
 * 不把续费做出"第三个价格档"，而是相对价目表折算，因为续费属于价格规则的一次性
 * 调整，改成别的折扣时价目表不用动；订单里已扣 `renewal` 标志，历史订单永远按当时
 * 折算值结算。打折只在此处发生，界面与路由都不再叠折扣。
 */
export const RENEWAL_RATE = 0.8

/**
 * 生效期内续费价，分。`Math.round` 不是防御性的：8 折后仍要为整数分——金额从
 * 不含小数分开始，这里也不该出现。
 */
export function renewalPriceFor(
  plan: SubscriptionPlan,
  cycle: SubscriptionCycle
): number {
  return Math.round(priceFor(plan, cycle) * RENEWAL_RATE)
}

/** 订单的有效期：二维码 30 分钟内不扫就作废，与微信 Native 的惯例一致。 */
export const ORDER_TTL_MS = 30 * 60 * 1000

/** 目前唯一的商品。写成数组是为了让 zod 的 `z.enum` 与价目表共用一份定义。 */
export const PLAN_VALUES = SUBSCRIPTION_PLANS
export const CYCLE_VALUES = SUBSCRIPTION_CYCLES

/**
 * 类型原样转出。
 *
 * 价目表是"卖什么"的唯一答案，所以拿金额的人（`lib/billing/orders.ts`）顺手从这里
 * 取档位与周期的类型，而不是再记一个 `plan-types` 的路径——两条 import 路径指向同
 * 一个声明，但只有一条是"从价目表出发"的。
 */
export type { SubscriptionCycle, SubscriptionPlan } from "@/lib/billing/plan-types"

/**
 * 全部在售档位，供结算前的价目展示。
 *
 * 不导出 `PRICES_FEN` 本身：调用方要的是"能卖的东西的清单"，而一张裸的价格表会
 * 让"支持哪些 plan"这个问题在两个地方各答一次。
 */
export function planCatalog(): PlanPrice[] {
  const rows: PlanPrice[] = []
  for (const plan of PLAN_VALUES) {
    for (const cycle of CYCLE_VALUES) {
      rows.push({
        plan,
        cycle,
        amountFen: PRICES_FEN[plan][cycle],
        display: formatFen(PRICES_FEN[plan][cycle]),
        renewalAmountFen: renewalPriceFor(plan, cycle),
        renewalDisplay: formatFen(renewalPriceFor(plan, cycle)),
      })
    }
  }
  return rows
}

/**
 * 一个档位一个周期的价格。
 *
 * 找不到就抛——入参已经被 `z.enum(SUBSCRIPTION_PLANS / CYCLES)` 挡过一次，能走到
 * 这里还查不到，说明价目表和 zod 的定义不同步，那是一个配置错误而不是用户错误，
 * 静默返回 0 或 undefined 会让订单以 0 元成交。
 */
export function priceFor(plan: SubscriptionPlan, cycle: SubscriptionCycle): number {
  const price = PRICES_FEN[plan]?.[cycle]
  if (typeof price !== "number") {
    throw new Error(`No price configured for ${plan}/${cycle}`)
  }
  return price
}

/** 分 → "¥99.00" / "¥950.40"。分是整数，所以这里不会出现浮点尾巴。 */
export function formatFen(amountFen: number): string {
  const yuan = Math.floor(amountFen / 100)
  const cents = amountFen % 100
  return `¥${yuan}.${String(cents).padStart(2, "0")}`
}

/**
 * 商户侧订单号，同时作为微信的 `out_trade_no`。
 *
 * `SO` 前缀让日志里一眼看出这是订阅订单而不是别的什么单；正文 24 位大写字母数字
 * 取自 `nanoid` 的自定义 alphabet——默认 alphabet 含 `-` 和 `_`，而 `out_trade_no`
 * 只接受字母数字下划线，缺一个过滤就会在网关侧被拒。总长 26，落在微信的 32 上限内。
 */
export function newOrderId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  let id = ""
  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length]
  }
  return `SO${id}`
}

/**
 * 在 `base` 上加一个计费周期，按**日历**月而不是 30 天。
 *
 * 年付按 365 天算会在四年里漂掉一天，而订阅到期日是一个用户会截图拿去对质的日期。
 * 月末那一天要夹到目标月的最后一天：1 月 31 日 + 1 个月是 2 月 28/29 日，不是
 * 3 月 3 日——与 PostgreSQL 的 `+ interval '1 month'` 相同，所以两条路径对同一天
 * 给出同一个结果。
 */
export function addCycle(base: Date, cycle: SubscriptionCycle): Date {
  const months = cycle === "yearly" ? 12 : 1
  const next = new Date(base.getTime())
  const targetMonthIndex = next.getUTCMonth() + months
  const lastDayOfTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), targetMonthIndex + 1, 0)
  ).getUTCDate()
  next.setUTCMonth(targetMonthIndex, Math.min(next.getUTCDate(), lastDayOfTargetMonth))
  return next
}
