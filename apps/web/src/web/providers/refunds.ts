/**
 * 退款：撤销买家权益 + 退回余额 + 生成负向 clawback 收入行。
 *
 * 三步在**一个事务**里，顺序不能换：
 *
 *   1. `SELECT ... FOR UPDATE` 锁住 entitlement，并要求 `status = 'active'`
 *   2. 权益置 `revoked`，金额退回买家余额
 *   3. 写一条 `kind = 'clawback'` 的负收入行，`reverses_earning_id` 指回原销售行
 *
 * 为什么必须是一个事务：步骤 1 的 `status = 'active'` 是唯一的重复退款闸门。
 * 两个并发请求都能读到 `active`，只有 `FOR UPDATE` 让第二个等待并看到
 * 已经变成 `revoked` 的结果——否则会退两次钱、冲两次分成。
 *
 * 为什么不删原销售行：账单是按月聚合 `provider_earnings` 的，删掉会让
 * 创作者当月的账单凭空少一笔，看起来像平台吞了钱。补一条负数行后，
 * 账单里 `sale` 与 `clawback` 两行同时在，两边都能对上账。
 *
 * 钱退回**平台余额**而非原路：钱包是站内唯一的可退渠道，且原支付渠道
 * （微信/支付宝/对公转账）退款需要各自的商户 API 与资质。退款金额
 * 因此记在各授权表的 `refundedAmount` 上，来源渠道流水由财务侧
 * 线下核对，不在这里伪造。
 *
 * 三种资产（skill / MCP / A2A）的授权表字段结构一致，所以退款逻辑按 kind
 * 分派到同一段实现而不是三份副本：钱包口径、`FOR UPDATE` 闸门、clawback
 * 比例计算在任何一处改动都必须同时作用于三者。
 */

import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import {
  a2aAgentEntitlements,
  a2aAgents,
  balances,
  createId,
  mcpServerEntitlements,
  mcpServers,
  providerEarnings,
  skillEntitlements,
  skills,
  user,
} from '@workspace/db'
import { db } from '@/lib/db'

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function money(value: string | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export type RefundResult =
  | {
      ok: true
      entitlementId: string
      refundedAmount: number
      clawbackId: string | null
      /** 原销售行不存在（老数据或网关分成）时为 true，无行可冲。 */
      clawbackSkipped: boolean
    }
  | { ok: false; error: string }

/** 可退款的资产类型。三张授权表字段结构一致，因此共用同一段退款实现。 */
export type RefundableKind = 'skill' | 'mcp' | 'a2a'

/**
 * 退款一笔购买（MCP / A2A / Skill 通用）。
 *
 * `reason` 落库到 `revocationReason`，因为"为什么退"是创作者看账单时
 * 唯一能解释这笔负数的信息。
 */
export async function refundEntitlement(params: {
  entitlementId: string
  kind: RefundableKind
  adminUserId: string
  reason: string
  /** 部分退款：只退一部分，clawback 按退款比例冲。缺省全额退。 */
  amount?: number
}): Promise<RefundResult> {
  const reason = params.reason.trim()
  if (!reason) return { ok: false, error: '请填写退款原因' }

  const requested = params.amount
  if (requested != null && (!Number.isFinite(requested) || requested <= 0)) {
    return { ok: false, error: '退款金额无效' }
  }

  const table =
    params.kind === 'mcp'
      ? mcpServerEntitlements
      : params.kind === 'a2a'
        ? a2aAgentEntitlements
        : skillEntitlements

  try {
    return await db.transaction(async (tx) => {
      // `FOR UPDATE` 是唯一的重复退款闸门：两个并发退款都能读到 `active`，
      // 只有行锁让第二个等待并看到已变成 `revoked` 的结果。
      const [entitlement] = await tx
        .select()
        .from(table)
        .where(eq(table.id, params.entitlementId))
        .limit(1)
        .for('update')

      if (!entitlement) return { ok: false as const, error: '订单不存在' }
      if (entitlement.status === 'revoked') {
        return { ok: false as const, error: '该订单已退款，不能重复退款' }
      }

      const original = money(entitlement.amount)
      const alreadyRefunded = money(entitlement.refundedAmount)
      const remaining = original - alreadyRefunded
      if (remaining <= 0) {
        return { ok: false as const, error: '该订单已全额退款' }
      }

      const refund = requested == null ? remaining : Math.min(requested, remaining)
      const refundStr = round2(refund)

      await tx
        .update(table)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          revocationReason: reason,
          refundedAmount: round2(alreadyRefunded + refund),
          refundedAt: new Date(),
          // 谁批的。退款是资金流出，没有这个字段就无法在买家投诉时回答
          // "谁退的"，也无法追责。
          refundedBy: params.adminUserId,
        } as never)
        .where(and(eq(table.id, params.entitlementId), eq(table.status, 'active')))

      // 退款回到平台余额。`amountTotal` 是"账户总余额"的口径，充值时加、
      // 消费时减，退款是收入的反向，所以同样要减，避免总余额虚高。
      await tx
        .update(balances)
        .set({
          amount: sql`${balances.amount} + ${refundStr}::numeric`,
          amountTotal: sql`${balances.amountTotal} + ${refundStr}::numeric`,
          amountSpend: sql`${balances.amountSpend} - ${refundStr}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(balances.userId, entitlement.userId))

      // 找原销售行。找不到就不冲回：网关分成没有 entitlementId，退款一条
      // 没有对应收入的 clawback 只会凭空扣创作者的钱。
      const [sale] = await tx
        .select({
          id: providerEarnings.id,
          grossAmount: providerEarnings.grossAmount,
          platformFee: providerEarnings.platformFee,
          netAmount: providerEarnings.netAmount,
          authorId: providerEarnings.authorId,
          buyerUserId: providerEarnings.buyerUserId,
          skillId: providerEarnings.skillId,
          // MCP / A2A 购买的归属要一起带回来：clawback 是那张账单里解释
          // "为什么这个月少了一笔" 的唯一一行，丢掉归属会让创作者看到一笔
          // 没有出处的负数。
          assetType: providerEarnings.assetType,
          assetId: providerEarnings.assetId,
          currency: providerEarnings.currency,
        })
        .from(providerEarnings)
        .where(eq(providerEarnings.entitlementId, params.entitlementId))
        .limit(1)

      if (!sale) {
        return {
          ok: true as const,
          entitlementId: entitlement.id,
          refundedAmount: refund,
          clawbackId: null,
          clawbackSkipped: true,
        }
      }

      // 按退款比例冲回。全额退款得到完全相反的一行，比例退款得到对应的
      // 负数行——所以部分退款同样能进账单，而不是留下没收掉的差额。
      const ratio = original > 0 ? refund / original : 0
      const clawbackId = createId()

      await tx.insert(providerEarnings).values({
        id: clawbackId,
        authorId: sale.authorId,
        buyerUserId: sale.buyerUserId,
        skillId: sale.skillId,
        assetType: sale.assetType,
        assetId: sale.assetId,
        entitlementId: entitlement.id,
        reversesEarningId: sale.id,
        kind: 'clawback',
        grossAmount: round2(-money(sale.grossAmount) * ratio),
        platformFee: round2(-money(sale.platformFee) * ratio),
        netAmount: round2(-money(sale.netAmount) * ratio),
        currency: sale.currency,
        status: 'payable',
      })

      return {
        ok: true as const,
        entitlementId: entitlement.id,
        refundedAmount: refund,
        clawbackId,
        clawbackSkipped: false,
      }
    })
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '退款失败',
    }
  }
}

/** Skill 专用别名，保留给既有调用点（后台退款入口、既有测试）。 */
export function refundSkillEntitlement(params: {
  entitlementId: string
  adminUserId: string
  reason: string
  amount?: number
}): Promise<RefundResult> {
  return refundEntitlement({ ...params, kind: 'skill' })
}

/**
 * 后台可退款权益列表。
 *
 * 退款接口需要一个入口，但后台此前没有任何地方能列出 `skill_entitlements`
 * ——只能靠手写 API 调用去猜 id。这条查询就是那个入口。
 *
 * 默认只列 `active`（还能退的），`status: 'all'` 才带上已撤销的——默认列
 * 已撤销的行会让运营对着一个已经退过的权益再点一次退款，然后拿到"已退款"
 * 错误，看起来像系统坏了。
 *
 * `total` 是独立的 `count(*)`，不是 `rows.length`：分页时后者只是当页行数，
 * 拿它当总数会让"共 3 条"在翻到第二页后变成"共 20 条"。
 */
export async function adminListRefundableEntitlements(
  options: {
    status?: 'active' | 'revoked' | 'all'
    /** 缺省列出全部可退资产类型。 */
    kind?: RefundableKind | 'all'
    search?: string
    limit?: number
    offset?: number
  } = {}
) {
  const { status = 'active', search, limit = 50, offset = 0 } = options
  const kind = options.kind ?? 'all'

  // `as const` 保住字面量类型：索引访问在 noUncheckedIndexedAccess 下会退成
  // `T | undefined`，循环里就得处处 `!`。
  const kinds = (kind === 'all' ? (['skill', 'mcp', 'a2a'] as const) : ([kind] as const)).slice()

  const configFor = (k: RefundableKind) => {
    if (k === 'mcp') {
      return {
        table: mcpServerEntitlements,
        assetTable: mcpServers,
        assetName: mcpServers.name,
        assetId: mcpServerEntitlements.mcpServerId,
      }
    }
    if (k === 'a2a') {
      return {
        table: a2aAgentEntitlements,
        assetTable: a2aAgents,
        assetName: a2aAgents.name,
        assetId: a2aAgentEntitlements.a2aAgentId,
      }
    }
    return {
      table: skillEntitlements,
      assetTable: skills,
      assetName: skills.title,
      assetId: skillEntitlements.skillId,
    }
  }

  /**
   * 过滤条件必须**逐类**构造。
   *
   * 之前这里是构造一次 `where` 然后喂给三类查询，MCP/A2A 的 SQL 里就出现了
   * `skill_entitlements.status` / `skills.title`——而这两张表不在那条查询的
   * FROM / JOIN 里。默认 `status = 'active'` 恒成立，所以**每一次**跨类型列表
   * 都会报 missing FROM-clause，整页退款后台对 MCP/A2A 完全不可用；只查
   * `kind: 'skill'` 时恰好能用，掩盖了这个 bug。
   *
   * 金额列和状态列同理：引用了别的表的列，聚合和排序都会跟着失效。
   */
  const conditionsFor = (k: RefundableKind) => {
    const { table, assetName: nameColumn } = configFor(k)
    const conditions = []

    if (status !== 'all') conditions.push(eq(table.status, status))

    const keyword = search?.trim()
    if (keyword) {
      // 同时匹配买家邮箱、资产名和订单号：运营接到投诉时手里通常只有其中
      // 一个（邮箱或订单号），只匹配其中一个会让另一半的工单没法处理。
      const pattern = `%${keyword}%`
      const like = or(
        ilike(user.email, pattern),
        ilike(nameColumn, pattern),
        ilike(table.orderId, pattern),
        ilike(table.id, pattern)
      )
      if (like) conditions.push(like)
    }

    return conditions.length ? and(...conditions) : undefined
  }

  const selectFor = (k: RefundableKind) => {
    const { table, assetTable, assetName: nameColumn, assetId: idColumn } = configFor(k)
    return db
      .select({
        id: table.id,
        userId: table.userId,
        buyerEmail: user.email,
        assetId: idColumn,
        assetName: nameColumn,
        orderId: table.orderId,
        amount: table.amount,
        currency: table.currency,
        status: table.status,
        refundedAmount: table.refundedAmount,
        refundedBy: table.refundedBy,
        revokedAt: table.revokedAt,
        revocationReason: table.revocationReason,
        createdAt: table.createdAt,
      })
      .from(table)
      .leftJoin(user, eq(table.userId, user.id))
      .leftJoin(assetTable, eq(idColumn, assetTable.id))
      .where(conditionsFor(k))
  }

  // 总数与可退金额按类分别算再相加：COUNT/SUM 不受分页影响，逐类聚合与跨表
  // 一次聚合等价，但不必把三张表套进同一个子查询。
  const totals = (
    await Promise.all(
      kinds.map(async (k) => {
        const { table, assetTable, assetId: idColumn } = configFor(k)
        const [row] = await db
          .select({
            total: count(),
            refundable: sql<string>`coalesce(sum(${table.amount} - coalesce(${table.refundedAmount}, 0)), 0)`,
          })
          .from(table)
          .leftJoin(user, eq(table.userId, user.id))
          .leftJoin(assetTable, eq(idColumn, assetTable.id))
          .where(conditionsFor(k))
        return { total: row?.total ?? 0, refundable: row?.refundable ?? '0' }
      })
    )
  ).reduce(
    (acc, entry) => ({
      total: acc.total + entry.total,
      refundable: acc.refundable + money(entry.refundable),
    }),
    { total: 0, refundable: 0 }
  )

  /**
   * 行数据：每类多取 `offset + limit` 条，合并后按时间倒序再切出全局窗口。
   *
   * 之前是各类各取 `limit` 条（有的还带 offset），合并后 `slice(0, limit)`：
   * 第一页碰巧对，第二页起就错了——第一页挤掉的行不会再出现，而各类 offset
   * 之后捞到的行里混着本该留在第一页的更早数据，运营翻页会漏行。
   *
   * 多取 `offset + limit` 条就能保证不漏：全局窗口 [offset, offset+limit) 里的
   * 任一行，在它自己那一类里必然排在前 `offset + limit` 名之内，所以三类各取这些
   * 再合并排序，窗口内的行一定齐全。写成一个跨表 `UNION ALL` 也能得到同样结果，
   * 但三张表字段一致时的列名对齐要靠第一支的列名推断，读起来反而不如这样直白。
   */
  const perKind = await Promise.all(
    kinds.map((k) =>
      selectFor(k)
        .orderBy(desc(configFor(k).table.createdAt))
        .limit(offset + limit)
    )
  )

  const rows = perKind
    // `i` 必然落在 `kinds` 内，但 noUncheckedIndexedAccess 让它退成 `| undefined`，
    // 而调用方要按 `kind` 分派退款，不能是可选的。
    .flatMap((entries, i) => entries.map((row) => ({ kind: kinds[i]!, ...row })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(offset, offset + limit)

  return {
    total: totals.total,
    refundableTotal: totals.refundable,
    list: rows.map((row) => ({
      ...row,
      amount: money(row.amount),
      refundedAmount: money(row.refundedAmount),
      /** 还能退多少。全额未退时等于 `amount`。 */
      refundable: money(row.amount) - money(row.refundedAmount),
    })),
  }
}
