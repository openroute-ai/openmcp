/**
 * 结账链路里**不碰数据库**的那几处：价目表、订单号、计费周期的推进、登录回跳的
 * 白名单。
 *
 * 值得单独钉住的理由，是这四处都属于"写错了不会报错、只会安静地给出错答案"的
 * 代码：价格写成 `990` 而不是 `9900`，订单照样创建、微信照样收款，只是少收一个
 * 零；`addCycle` 用 30 天代替日历月，到期日会在四年后漂掉一天，而那是一个用户会
 * 截图拿去对质的日期；回跳白名单放行一个 `//evil.com`，登录后就会被送出站。
 *
 * 集成测试覆盖的是"行写进去了"，验不出上面任何一条。
 */

import { describe, expect, it } from "vitest"

import {
  RENEWAL_RATE,
  addCycle,
  formatFen,
  newOrderId,
  planCatalog,
  priceFor,
  renewalPriceFor,
} from "@/lib/billing/plans"
import { safeCallbackPath, withCallback } from "@/lib/auth/callback"

describe("planCatalog", () => {
  it("covers every plan × cycle pair exactly once", () => {
    const catalog = planCatalog()
    expect(catalog).toHaveLength(2)
    expect(catalog.map((row) => `${row.plan}/${row.cycle}`).sort()).toEqual([
      "pro/monthly",
      "pro/yearly",
    ])
  })

  it("prices Pro at ¥99/month and ¥950.40/year, in whole fen", () => {
    const byKey = new Map(planCatalog().map((row) => [`${row.plan}/${row.cycle}`, row]))

    // 8 折年付是 ¥99 × 12 × 0.8，用整数分算：9900 × 12 × 0.8 = 95040。
    expect(byKey.get("pro/monthly")?.amountFen).toBe(9_900)
    expect(byKey.get("pro/yearly")?.amountFen).toBe(95_040)

    for (const row of byKey.values()) {
      expect(Number.isInteger(row.amountFen)).toBe(true)
      expect(row.amountFen).toBeGreaterThan(0)
    }
  })

  it("hands the dialog a pre-formatted amount", () => {
    // 界面不自己拼金额：`display` 是服务端算好的，避免两处格式各写一遍。
    const display = new Map(planCatalog().map((row) => [row.cycle, row.display]))
    expect(display.get("monthly")).toBe("¥99.00")
    expect(display.get("yearly")).toBe("¥950.40")
  })
})

describe("renewalPriceFor", () => {
  it("is the list price × RENEWAL_RATE, rounded to whole fen", () => {
    // 生效期内续费 8 折：月付 ¥79.20 = 7920 分，年付 ¥760.32 = 76032 分。
    // 与 `display` 一样不出现浮点尾巴，`Math.round` 必须存在。
    expect(renewalPriceFor("pro", "monthly")).toBe(7_920)
    expect(renewalPriceFor("pro", "yearly")).toBe(76_032)
    expect(renewalPriceFor("pro", "monthly")).toBe(
      Math.round(priceFor("pro", "monthly") * RENEWAL_RATE)
    )
  })

  it("catalog carries the discounted pair next to the list price", () => {
    for (const row of planCatalog()) {
      expect(row.renewalAmountFen).toBe(renewalPriceFor(row.plan, row.cycle))
      expect(row.renewalDisplay).toBe(formatFen(row.renewalAmountFen))
      // 折扣作用于一个周期，而不是把折扣再叠一次。
      expect(row.renewalAmountFen).toBeLessThan(row.amountFen)
    }
  })
})

describe("priceFor", () => {
  it("agrees with the catalog", () => {
    for (const row of planCatalog()) {
      expect(priceFor(row.plan, row.cycle)).toBe(row.amountFen)
    }
  })
})

describe("formatFen", () => {
  it("formats without a floating-point tail", () => {
    expect(formatFen(9_900)).toBe("¥99.00")
    expect(formatFen(95_040)).toBe("¥950.40")
    expect(formatFen(1)).toBe("¥0.01")
    expect(formatFen(0)).toBe("¥0.00")
  })
})

describe("newOrderId", () => {
  it("is a 26-char alphanumeric id WeChat accepts as out_trade_no", () => {
    const id = newOrderId()
    expect(id).toMatch(/^SO[0-9A-Za-z]{24}$/)
    // 微信的上限是 32；这个长度是 `SO` 前缀 + 24 位正文的结果，不是巧合。
    expect(id.length).toBeLessThanOrEqual(32)
  })

  it("does not collide with itself", () => {
    // 同一秒内连续建单（关掉弹窗又打开）会用到两次。24 位 × 62 字符的空间下
    // 撞车的概率可以忽略，但这里钉的是"每次调用都重新取随机字节"这件事本身。
    const ids = new Set(Array.from({ length: 500 }, () => newOrderId()))
    expect(ids.size).toBe(500)
  })
})

describe("addCycle", () => {
  it("advances by calendar months, not by 30 days", () => {
    // 1 月 31 日 + 1 个月是 2 月 28 日，不是 3 月 3 日——与 PostgreSQL 的
    // `+ interval '1 month'` 同解，两条路径对同一天必须给出同一个结果。
    expect(addCycle(new Date("2026-01-31T12:00:00.000Z"), "monthly")).toEqual(
      new Date("2026-02-28T12:00:00.000Z")
    )

    // 闰年要夹到 29 日。
    expect(addCycle(new Date("2024-01-31T00:00:00.000Z"), "monthly")).toEqual(
      new Date("2024-02-29T00:00:00.000Z")
    )

    // 月中不受月末夹取影响。
    expect(addCycle(new Date("2026-06-15T08:30:00.000Z"), "monthly")).toEqual(
      new Date("2026-07-15T08:30:00.000Z")
    )
  })

  it("advances a year by twelve months, keeping the day", () => {
    expect(addCycle(new Date("2026-03-15T00:00:00.000Z"), "yearly")).toEqual(
      new Date("2027-03-15T00:00:00.000Z")
    )
    // 2 月 29 日订的年付，下一年只有 28 日可夹。
    expect(addCycle(new Date("2024-02-29T00:00:00.000Z"), "yearly")).toEqual(
      new Date("2025-02-28T00:00:00.000Z")
    )
  })

  it("does not mutate its input", () => {
    const base = new Date("2026-01-31T00:00:00.000Z")
    addCycle(base, "monthly")
    expect(base).toEqual(new Date("2026-01-31T00:00:00.000Z"))
  })
})

describe("safeCallbackPath", () => {
  it("keeps the path the checkout dialog actually sends", () => {
    expect(safeCallbackPath("/")).toBe("/")
    // 结账弹窗的回跳目标：登录完成后落地页靠它重新打开弹窗。
    expect(safeCallbackPath("/?plan=pro")).toBe("/?plan=pro")
    expect(safeCallbackPath("/console")).toBe("/console")
    expect(safeCallbackPath("  /settings  ")).toBe("/settings")
  })

  it("rejects anything that could leave the site", () => {
    // `//host` 是协议相对 URL，`/\/host` 被浏览器归一成 `//host`。
    expect(safeCallbackPath("//evil.com")).toBeUndefined()
    expect(safeCallbackPath("/\\evil.com")).toBeUndefined()
    expect(safeCallbackPath("https://evil.com")).toBeUndefined()
    expect(safeCallbackPath("javascript:alert(1)")).toBeUndefined()
    // 换行可以截断后续 URL 的一部分，属于同一类注入。
    expect(safeCallbackPath("/console\n//evil.com")).toBeUndefined()
    expect(safeCallbackPath("/console\r\n//evil.com")).toBeUndefined()
  })

  it("rejects non-strings and absurd lengths instead of throwing", () => {
    expect(safeCallbackPath(undefined)).toBeUndefined()
    expect(safeCallbackPath(null)).toBeUndefined()
    expect(safeCallbackPath(42)).toBeUndefined()
    expect(safeCallbackPath({ href: "/console" })).toBeUndefined()
    expect(safeCallbackPath("")).toBeUndefined()
    expect(safeCallbackPath("   ")).toBeUndefined()
    expect(safeCallbackPath(`/${"a".repeat(5000)}`)).toBeUndefined()
  })
})

describe("withCallback", () => {
  it("leaves the link alone when there is no callback", () => {
    expect(withCallback("/sign-up", undefined)).toBe("/sign-up")
    expect(withCallback("/sign-in", "")).toBe("/sign-in")
  })

  it("carries the callback across the 登录 ↔ 注册 hop", () => {
    expect(withCallback("/sign-up", "/?plan=pro")).toBe(
      "/sign-up?callbackURL=%2F%3Fplan%3Dpro"
    )
  })
})
