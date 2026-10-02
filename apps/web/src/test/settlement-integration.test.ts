/**
 * 结算链路集成测试：直接打真实 PostgreSQL。
 *
 * 不用 mock，因为要验的正是 mock 掉的东西：
 *
 * - `FOR UPDATE` 的并发行为（两个并发退款只能成功一个）
 * - `numeric` 的余额运算（不是 JS 浮点）
 * - 事务回滚后不留下半截数据（撤销了权益但钱没退）
 * - 数据库 CHECK 约束真的拦得住手写 SQL 绕过应用层
 *
 * 这些都无法用内存替身证明：JS 的 `0.1 + 0.2 !== 0.3` 与 PostgreSQL 的
 * `numeric` 行为不同，事务的隔离级别也无法靠 mock 复现。
 *
 * 每个用例都用带 `__p2test` 前缀的唯一 id，结束时统一清理，不会碰到真实数据。
 */

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  authors,
  balances,
  providerEarnings,
  providerProfiles,
  skillEntitlements,
  skills,
  user,
} from "@workspace/db"
import { db } from "@/lib/db"
import { refundSkillEntitlement } from "@/web/providers/refunds"
import {
  adminGetStatement,
  autoConfirmOverdueStatements,
  generateStatements,
  listMyStatements,
} from "@/web/providers/statements"

const SUFFIX = `p2test${Date.now()}`
const AUTHOR_ID = `author-${SUFFIX}`
const SKILL_ID = `skill-${SUFFIX}`
const BUYER_ID = `buyer-${SUFFIX}`
const ADMIN_ID = `admin-${SUFFIX}`
const PERIOD = "2099-01"

const createdUsers: string[] = []

async function createUser(name: string): Promise<string> {
  const id = `user-${name}-${SUFFIX}`
  await db.insert(user).values({
    id,
    name,
    email: `${id}@p2test.example`,
    emailVerified: true,
  } as never)
  createdUsers.push(id)
  return id
}

beforeAll(async () => {
  await db.insert(authors).values({
    id: AUTHOR_ID,
    name: `p2-author-${SUFFIX}`,
    username: `p2-author-${SUFFIX}`,
  } as never)

  await createUser("buyer")
  createdUsers.push(ADMIN_ID)
  await db
    .insert(user)
    .values({
      id: ADMIN_ID,
      name: "p2-admin",
      email: `admin-${SUFFIX}@p2test.example`,
    } as never)

  await db.insert(providerProfiles).values({
    userId: ADMIN_ID,
    authorId: AUTHOR_ID,
    verificationStatus: "verified",
    payChannelType: "wechat",
    payChannelStatus: "ready",
    metadata: { payoutAccounts: { wechat: { account: "wx-p2test-001" } } },
  } as never)

  await db.insert(balances).values({
    userId: BUYER_ID,
    amount: "100.00",
    amountTotal: "100.00",
    amountSpend: "0.00",
  } as never)

  // `provider_earnings.skill_id` 与 `skill_entitlements.skill_id` 都有外键指向
  // `skills`，所以必须先建这条真实 Skill 行——用假 id 会被 FK 挡下，测出来的
  // 是"插入失败"而不是结算逻辑。
  await db.insert(skills).values({
    id: SKILL_ID,
    referenceId: `ref-${SUFFIX}`,
    slug: `p2-skill-${SUFFIX}`,
    title: `P2 测试 Skill ${SUFFIX}`,
    authorId: AUTHOR_ID,
    pricingModel: "paid",
    priceAmount: "50.00",
  } as never)
})

afterAll(async () => {
  // 反向依赖顺序：先删叶子表，再删被引用的父行。
  await db
    .delete(providerEarnings)
    .where(eq(providerEarnings.authorId, AUTHOR_ID))
  await db
    .delete(skillEntitlements)
    .where(eq(skillEntitlements.skillId, SKILL_ID))
  await db.delete(skills).where(eq(skills.id, SKILL_ID))
  for (const id of extraSkillIds) {
    await db
      .delete(skills)
      .where(eq(skills.id, id))
      .catch(() => undefined)
  }
  await db
    .delete(providerProfiles)
    .where(eq(providerProfiles.authorId, AUTHOR_ID))
  await db.delete(balances).where(eq(balances.userId, BUYER_ID))
  await db.delete(authors).where(eq(authors.id, AUTHOR_ID))
  for (const id of createdUsers) {
    await db
      .delete(user)
      .where(eq(user.id, id))
      .catch(() => undefined)
  }
})

/**
 * 每个用例用独立的 Skill 行。
 *
 * `skill_entitlements` 上有 `(user_id, skill_id)` 唯一约束（一人一技能只能有一
 * 条权益，复购是复用同一行）。共用一个 skill 的话，第二个退款用例插权益就会
 * 撞唯一键——报错说的是唯一键冲突，读起来像产品缺陷，其实是测试数据没隔离。
 */
const extraSkillIds: string[] = []

async function createSkill(title: string): Promise<string> {
  const id = `skill-${Math.random().toString(36).slice(2)}-${SUFFIX}`
  await db.insert(skills).values({
    id,
    referenceId: `ref-${id}`,
    slug: `p2-${id}`,
    title,
    authorId: AUTHOR_ID,
    pricingModel: "paid",
    priceAmount: "50.00",
  } as never)
  extraSkillIds.push(id)
  return id
}

/** 在结算月内插入一条销售分成。 */
async function insertSale(opts: {
  net: string
  entitlementId?: string
  createdAt: Date
  skillId?: string
}) {
  const id = `earn-${Math.random().toString(36).slice(2)}-${SUFFIX}`
  await db.insert(providerEarnings).values({
    id,
    authorId: AUTHOR_ID,
    buyerUserId: BUYER_ID,
    skillId: opts.skillId ?? SKILL_ID,
    entitlementId: opts.entitlementId ?? null,
    kind: "sale",
    grossAmount: opts.net,
    platformFee: "0.00",
    netAmount: opts.net,
    currency: "CNY",
    status: "payable",
    createdAt: opts.createdAt,
  } as never)
  return id
}

/** 通过真实查询取账单：只走 `listMyStatements` + `adminGetStatement`。 */
async function statementFor(period: string) {
  const list = await listMyStatements(AUTHOR_ID, { limit: 50 })
  const row = list.rows.find((r) => r.period === period)
  if (!row) throw new Error(`找不到 ${period} 的账单`)
  const detail = await adminGetStatement(row.id)
  if (!detail) throw new Error(`账单 ${row.id} 明细缺失`)
  return { ...detail.statement, earnings: detail.earnings }
}

async function insertEntitlement(amount = "50.00", skillId: string = SKILL_ID) {
  const id = `ent-${Math.random().toString(36).slice(2)}-${SUFFIX}`
  await db.insert(skillEntitlements).values({
    id,
    userId: BUYER_ID,
    skillId,
    amount,
    currency: "CNY",
    status: "active",
  } as never)
  return id
}

describe("月度账单出账", () => {
  it("聚合当月收入并快照收款账号", async () => {
    await insertSale({
      net: "100.00",
      createdAt: new Date("2099-01-10T00:00:00Z"),
    })
    await insertSale({
      net: "50.00",
      createdAt: new Date("2099-01-20T00:00:00Z"),
    })

    const result = await generateStatements(new Date("2099-02-05T01:00:00Z"), {
      period: PERIOD,
    })
    expect(result.created).toBe(1)

    const detail = await statementFor(PERIOD)
    expect(detail.netAmount).toBe(150)
    expect(detail.payableAmount).toBe(150)
    expect(detail.earnings).toHaveLength(2)
    // 收款快照在出账时写入，之后换绑账号不影响这张账单。
    expect(detail.payoutAccount).toBe("wx-p2test-001")
    expect(detail.payoutChannel).toBe("wechat")
  })

  it("重复出账不会重复计费", async () => {
    const again = await generateStatements(new Date("2099-02-06T01:00:00Z"), {
      period: PERIOD,
    })
    expect(again.created).toBe(0)

    const detail = await statementFor(PERIOD)
    expect(detail.netAmount).toBe(150)
    expect(detail.earnings).toHaveLength(2)
  })

  it("负账单不产生应付金额", async () => {
    await insertSale({
      net: "20.00",
      createdAt: new Date("2099-02-10T00:00:00Z"),
    })
    // 造一个负缺口：当月 clawback 超过收入。
    await db.insert(providerEarnings).values({
      id: `earn-neg-${SUFFIX}`,
      authorId: AUTHOR_ID,
      buyerUserId: BUYER_ID,
      skillId: SKILL_ID,
      kind: "clawback",
      reversesEarningId: `reverses-neg-${SUFFIX}`,
      grossAmount: "-80.00",
      platformFee: "0.00",
      netAmount: "-80.00",
      currency: "CNY",
      status: "payable",
      createdAt: new Date("2099-02-10T00:00:00Z"),
    } as never)

    const result = await generateStatements(new Date("2099-03-05T01:00:00Z"), {
      period: "2099-02",
    })
    // 净收入为负 → 落 `rolled`，所以计进 `rolled` 而不是 `created`。
    expect(result.created).toBe(0)
    expect(result.rolled).toBe(1)

    const detail = await statementFor("2099-02")
    expect(detail.netAmount).toBe(-60)
    expect(detail.status).toBe("rolled")
    expect(detail.payableAmount).toBe(0)
  })

  it("缺口滚入下期，且不会被扣两次", async () => {
    await insertSale({
      net: "40.00",
      createdAt: new Date("2099-03-10T00:00:00Z"),
    })
    await generateStatements(new Date("2099-04-05T01:00:00Z"), {
      period: "2099-03",
    })

    const march = await statementFor("2099-03")
    expect(march.carryoverAmount).toBe(-60)
    expect(march.netAmount).toBe(40)
    expect(march.settlement).toBe(-20)
    expect(march.status).toBe("rolled")

    // 4 月收入 100 覆盖缺口：结算额 80，且 carryover 必须回到 0，
    // 否则 5 月账单会再扣一次同样的 60。
    await insertSale({
      net: "100.00",
      createdAt: new Date("2099-04-10T00:00:00Z"),
    })
    await generateStatements(new Date("2099-05-05T01:00:00Z"), {
      period: "2099-04",
    })
    const april = await statementFor("2099-04")
    expect(april.carryoverAmount).toBe(-20)
    expect(april.settlement).toBe(80)
    expect(april.status).toBe("pending")

    await insertSale({
      net: "10.00",
      createdAt: new Date("2099-05-10T00:00:00Z"),
    })
    await generateStatements(new Date("2099-06-05T01:00:00Z"), {
      period: "2099-05",
    })
    const may = await statementFor("2099-05")
    expect(may.carryoverAmount).toBe(0)
    expect(may.netAmount).toBe(10)
    expect(may.settlement).toBe(10)
  })
})

describe("出账口径", () => {
  it("只剩已走老提现路径付过的历史收入时，不生成空账单", async () => {
    // 老的 `payout_requests` 路径打款后会把收入行翻成 `paid`，但
    // `statement_id` 仍然是 NULL。这笔钱已经付过了，如果出账候选只按
    // `statement_id IS NULL` 选，它会被重新选中，然后内部聚合成 net=0
    // 并落一张 payableAmount=0 的假账单。
    await db.insert(providerEarnings).values({
      id: `earn-oldpaid-${SUFFIX}`,
      authorId: AUTHOR_ID,
      buyerUserId: BUYER_ID,
      skillId: SKILL_ID,
      kind: "sale",
      grossAmount: "99.00",
      platformFee: "0.00",
      netAmount: "99.00",
      currency: "CNY",
      status: "paid",
      createdAt: new Date("2099-09-12T00:00:00Z"),
    } as never)

    const result = await generateStatements(new Date("2099-10-05T01:00:00Z"), {
      period: "2099-09",
    })
    expect(result.created).toBe(0)
    expect(result.rolled).toBe(0)
    expect(result.skipped).toBe(0)

    const list = await listMyStatements(AUTHOR_ID, { limit: 100 })
    expect(list.rows.some((r) => r.period === "2099-09")).toBe(false)
  })

  it("同月既有已付历史收入又有新收入时，只计新收入", async () => {
    await db.insert(providerEarnings).values({
      id: `earn-mixold-${SUFFIX}`,
      authorId: AUTHOR_ID,
      buyerUserId: BUYER_ID,
      skillId: SKILL_ID,
      kind: "sale",
      grossAmount: "99.00",
      platformFee: "0.00",
      netAmount: "99.00",
      currency: "CNY",
      status: "paid",
      createdAt: new Date("2099-10-08T00:00:00Z"),
    } as never)
    await insertSale({
      net: "25.00",
      createdAt: new Date("2099-10-18T00:00:00Z"),
    })

    const result = await generateStatements(new Date("2099-11-05T01:00:00Z"), {
      period: "2099-10",
    })
    expect(result.created).toBe(1)

    const detail = await statementFor("2099-10")
    expect(detail.netAmount).toBe(25)
    expect(detail.payableAmount).toBe(25)
    // 已付的那行不进账单，也不作为 carryover 重复计入。
    expect(
      detail.earnings.every(
        (e: { id: string }) => e.id !== `earn-mixold-${SUFFIX}`
      )
    ).toBe(true)
  })
})

describe("退款", () => {
  it("退钱、撤权益、留冲回行，且记录操作人", async () => {
    const skillId = await createSkill("退款-全额")
    const entitlementId = await insertEntitlement("50.00", skillId)
    const saleId = await insertSale({
      net: "50.00",
      entitlementId,
      skillId,
      createdAt: new Date("2099-06-10T00:00:00Z"),
    })

    const before = await db.query.balances.findFirst({
      where: eq(balances.userId, BUYER_ID),
    })

    const result = await refundSkillEntitlement({
      entitlementId,
      adminUserId: ADMIN_ID,
      reason: "集成测试：功能不可用",
    })
    expect(result.ok).toBe(true)

    const [ent] = await db
      .select()
      .from(skillEntitlements)
      .where(eq(skillEntitlements.id, entitlementId))
    expect(ent?.status).toBe("revoked")
    expect(ent?.revokedAt).toBeTruthy()
    expect(ent?.refundedBy).toBe(ADMIN_ID)
    expect(ent?.refundedAmount).toBe("50.00")

    // 余额用 numeric 精确加回，不出现 149.9999999 这种浮点尾巴。
    const after = await db.query.balances.findFirst({
      where: eq(balances.userId, BUYER_ID),
    })
    expect(Number(after?.amount) - Number(before?.amount)).toBe(50)

    // clawback 指回原销售行，金额为负。
    const clawback = await db
      .select()
      .from(providerEarnings)
      .where(eq(providerEarnings.reversesEarningId, saleId))
    expect(clawback).toHaveLength(1)
    expect(Number(clawback[0]?.netAmount)).toBe(-50)
    expect(clawback[0]?.kind).toBe("clawback")
  })

  it("重复退款被幂等拦下，不会二次退钱", async () => {
    const skillId = await createSkill("退款-重复调用")
    const entitlementId = await insertEntitlement("20.00", skillId)
    await insertSale({
      net: "20.00",
      entitlementId,
      skillId,
      createdAt: new Date("2099-06-11T00:00:00Z"),
    })

    const first = await refundSkillEntitlement({
      entitlementId,
      adminUserId: ADMIN_ID,
      reason: "第一次",
    })
    expect(first.ok).toBe(true)

    const before = await db.query.balances.findFirst({
      where: eq(balances.userId, BUYER_ID),
    })

    const second = await refundSkillEntitlement({
      entitlementId,
      adminUserId: ADMIN_ID,
      reason: "第二次",
    })
    expect(second.ok).toBe(false)

    const after = await db.query.balances.findFirst({
      where: eq(balances.userId, BUYER_ID),
    })
    // 余额没动 = 没有二次退钱。
    expect(after?.amount).toBe(before?.amount)
  })

  it("并发退款只有一个成功", async () => {
    const skillId = await createSkill("退款-并发")
    const entitlementId = await insertEntitlement("80.00", skillId)
    await insertSale({
      net: "80.00",
      entitlementId,
      skillId,
      createdAt: new Date("2099-06-12T00:00:00Z"),
    })

    const before = await db.query.balances.findFirst({
      where: eq(balances.userId, BUYER_ID),
    })

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        refundSkillEntitlement({
          entitlementId,
          adminUserId: ADMIN_ID,
          reason: `并发-${i}`,
        })
      )
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)

    const after = await db.query.balances.findFirst({
      where: eq(balances.userId, BUYER_ID),
    })
    expect(Number(after?.amount) - Number(before?.amount)).toBe(80)

    const [ent] = await db
      .select()
      .from(skillEntitlements)
      .where(eq(skillEntitlements.id, entitlementId))
    expect(ent?.refundedAmount).toBe("80.00")
  })

  it("部分退款按比例冲回，剩余金额不能再退", async () => {
    const skillId = await createSkill("退款-部分")
    const entitlementId = await insertEntitlement("100.00", skillId)
    const saleId = await insertSale({
      net: "100.00",
      entitlementId,
      skillId,
      createdAt: new Date("2099-06-13T00:00:00Z"),
    })

    const result = await refundSkillEntitlement({
      entitlementId,
      adminUserId: ADMIN_ID,
      reason: "部分退款",
      amount: 25,
    })
    expect(result.ok).toBe(true)

    const clawback = await db
      .select()
      .from(providerEarnings)
      .where(eq(providerEarnings.reversesEarningId, saleId))
    expect(Number(clawback[0]?.netAmount)).toBe(-25)

    const [ent] = await db
      .select()
      .from(skillEntitlements)
      .where(eq(skillEntitlements.id, entitlementId))
    expect(Number(ent?.refundedAmount)).toBe(25)
    expect(Number(ent?.amount) - Number(ent?.refundedAmount)).toBe(75)
  })

  it("空退款原因被拒绝", async () => {
    const skillId = await createSkill("退款-空原因")
    const entitlementId = await insertEntitlement("10.00", skillId)
    const result = await refundSkillEntitlement({
      entitlementId,
      adminUserId: ADMIN_ID,
      reason: "   ",
    })
    expect(result.ok).toBe(false)
  })
})

describe("数据库约束", () => {
  it("正数 clawback 被 CHECK 拦下", async () => {
    await expect(
      db.insert(providerEarnings).values({
        id: `bad-clawback-${SUFFIX}`,
        authorId: AUTHOR_ID,
        buyerUserId: BUYER_ID,
        skillId: SKILL_ID,
        kind: "clawback",
        reversesEarningId: `bad-reverses-${SUFFIX}`,
        grossAmount: "10.00",
        platformFee: "0.00",
        netAmount: "10.00",
        currency: "CNY",
        status: "payable",
      } as never)
    ).rejects.toThrow()
  })
})

describe("逾期自动确认", () => {
  it("确认截止后把 pending 账单翻成 confirmed", async () => {
    await insertSale({
      net: "30.00",
      createdAt: new Date("2099-07-10T00:00:00Z"),
    })
    await generateStatements(new Date("2099-08-05T01:00:00Z"), {
      period: "2099-07",
    })

    const result = await autoConfirmOverdueStatements(
      new Date("2099-08-25T01:00:00Z")
    )
    expect(result.autoConfirmed).toBeGreaterThanOrEqual(1)

    const detail = await statementFor("2099-07")
    expect(detail.status).toBe("confirmed")
    expect(detail.confirmedAt).toBeTruthy()
  })
})
