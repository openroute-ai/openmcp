/**
 * MCP / A2A 付费资产的门禁与购买。
 *
 * 单一实现同时服务 MCP 与 A2A 两种资产：两边的字段名、计价语义和钱包扣款
 * 口径完全一致，分成两份只会让两者在某次修改里悄悄分叉。
 *
 * 之前 `mcp_servers.price_type` / `a2a_agents.price_type` 只是两列没人读的数据：
 * 安装路径（`store-mcp/tools.ts` 的 `install_asset`）只看 `status`，所以一个标了
 * `paid` 的 MCP 任何登录用户都能直接装走并拿到 gatewayUrl —— 等于付费资产
 * 免费发。这不是"漏了提示"，是价格字段完全没接进控制流。
 *
 * 门禁放在**安装**这一步而不是调用那一步，原因和限制：
 *
 * - 安装是平台自己的代码，能拦。调用是买家直连 LiteLLM 公网地址
 *   （`buildMcpGatewayUrl`），平台侧没有 proxy，拦不住 —— 这与
 *   `mcp-servers/gateway.ts` 里 `toggle(false)` 的待定标记是同一个根因。
 *   所以"买了才能装"能保证，"没买一定调不通"目前做不到。
 * - 停在安装层意味着存量已发放的 virtual key 仍然有效。这是有意的过渡状态，
 *   不是疏漏：真正的调用侧门禁要等产品语义定了 LiteLLM 停用行为之后一起做。
 *
 * 计价口径：只支持一次性付费（`priceType = 'paid'` + `priceAmount`）。
 * `billing_model` 的 `pay_per_call` / `subscription` 不在这里扣费 —— 那是
 * 按调用结算，由 `lib/litellm/settlement.ts` 的 spend 结算负责；在安装时一次性
 * 收走 pay_per_call 的钱会让同一笔钱被收两次。遇到这两种计价模型一律按
 * "需在页面购买"处理，不静默放行也不在安装时扣款。
 */

import { and, eq, sql } from 'drizzle-orm'
import {
  a2aAgentEntitlements,
  a2aAgents,
  balances,
  createId,
  mcpServerEntitlements,
  mcpServers,
} from '@workspace/db'
import { db } from '@/lib/db'
import { creditAssetPurchaseEarning } from '@/web/providers/settlement'

export type AssetKind = 'mcp' | 'a2a'

export type EntitlementDecision =
  /**
   * `metered` 表示按次付费：安装时不要钱，钱在调用时收 —— 所以放行安装是
   * 正确的，不需要授权行。区别在于它与 `free` 的商业含义不同（资产是收费的，
   * 只是不在安装层收费），调用方要按 `metered` 展示"按量计费"。
   */
  | { allowed: true; reason: 'free' | 'entitled' | 'metered' }
  | {
      allowed: false
      /**
       * `NEED_PURCHASE` 可以在安装工具里直接给出购买链接；
       * `UNSUPPORTED_BILLING` 表示计价模型不在安装层处理，需要引导到页面；
       * `NO_PRICE` 表示资产标了 paid 但价格无效（0 / NULL / NaN）——
       * 这是提供方的配置错误，不能放行也不能让买家去买一个不存在的价格。
       */
      code: 'NEED_PURCHASE' | 'UNSUPPORTED_BILLING' | 'NO_PRICE'
      error: string
    }

/** 只在安装层一次性收取的计价模型。 */
const ONE_TIME_ONLY = new Set(['one_time', '', 'one-time', 'onetime'])

/**
 * 按次付费：钱在调用时收。
 *
 * 这类资产**不需要**授权行，也不该在安装时拦。`settleGatewaySpend` 已经在每次
 * 调用时扣买家余额并给 provider 记分成，安装层再收一次就是重复收费；
 * 反过来把它归入 `UNSUPPORTED_BILLING` 拦掉安装，则等于让一个计费模型完整的
 * 资产完全无法使用。
 */
const METERED = new Set(['pay_per_call', 'paypercall', 'per_call', 'percall'])

/**
 * 判断一次安装/下载是否被允许。
 *
 * 判定顺序刻意是"先看价格是否可信，再看是否已购"：
 * 一个 `paid` 但 `priceAmount` 为 0 或 NULL 的资产如果先查权益，免费用户会
 * 拿到 `NEED_PURCHASE` 而永远买不了（价格无效），但如果先放行就成了免费资产。
 * 这里选择显式报 `NO_PRICE`，让它在配置修好之前不可安装 —— 一台坏掉的
 * 收银机不该静默变成免费窗口。
 */
export async function checkAssetEntitlement(params: {
  userId: string
  kind: AssetKind
  assetId: string
}): Promise<EntitlementDecision> {
  const asset = await loadAsset(params.kind, params.assetId)
  if (!asset) {
    // 资产不存在时不走门禁：可见性由 `resolveMcp` / `resolveA2a` 负责，
    // 这里报"不可安装"会和那层的错误信息重复并误导。
    return { allowed: true, reason: 'free' }
  }

  if (asset.priceType !== 'paid') {
    return { allowed: true, reason: 'free' }
  }

  const billingModel = (asset.billingModel ?? '').trim().toLowerCase()

  // 按次付费放行安装：计费发生在调用链路上，不在安装链路上。
  if (METERED.has(billingModel)) {
    return { allowed: true, reason: 'metered' }
  }

  // subscription：整条链路（周期锚点、续费任务、过期撤销、取消）都没有实现，
  // 没有任何地方会给它开授权行。这里必须明确拦下并说明，而不是把它当成
  // 一次性付费去扣一笔"永久授权"的钱 —— 那等于收了钱却不给续费，等同于
  // 静默地把订阅卖成了买断。
  if (!ONE_TIME_ONLY.has(billingModel)) {
    return {
      allowed: false,
      code: 'UNSUPPORTED_BILLING',
      error: '该资产按订阅计费，订阅购买尚未上线，暂不可安装',
    }
  }

  const amountStr = asset.priceAmount?.toString() ?? ''
  const amount = Number(amountStr)
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    return { allowed: false, code: 'NO_PRICE', error: '该资产价格配置无效，暂不可安装' }
  }

  const entitled = await hasEntitlement(params)
  if (entitled) return { allowed: true, reason: 'entitled' }

  return { allowed: false, code: 'NEED_PURCHASE', error: '请先购买该资产' }
}

/**
 * 该资产是否必须先购买才能看到实现细节。
 *
 * 详情 query 对匿名访客不查授权（查了也拿不到），但"不查"不等于"放行"——
 * `access === null` 之前被当成"未购买"之外的情况，结果付费端点直接暴露给
 * 任何人。所以匿名路径按价格判断：只有免费和按次付费可以直接公开端点。
 *
 * 订阅和价格无效（NO_PRICE）同样算 gated：它们都是"不可安装"，把端端点公开
 * 出去等于给一个收银机坏了的商品开个后门。
 */
export async function assetIsGated(kind: AssetKind, assetId: string): Promise<boolean> {
  const asset = await loadAsset(kind, assetId)
  if (!asset) return false
  if (asset.priceType !== 'paid') return false
  return !METERED.has((asset.billingModel ?? '').trim().toLowerCase())
}

/** 只有 `active` 算已拥有：退款置 `revoked` 但保留行。 */
export async function hasEntitlement(params: {
  userId: string
  kind: AssetKind
  assetId: string
}): Promise<boolean> {
  const table =
    params.kind === 'mcp' ? mcpServerEntitlements : a2aAgentEntitlements
  const idColumn = params.kind === 'mcp' ? mcpServerEntitlements.mcpServerId : a2aAgentEntitlements.a2aAgentId

  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.userId, params.userId),
        eq(idColumn, params.assetId),
        // 必须显式过滤 status：唯一约束是 (userId, assetId)，退款后行还在，
        // 不看 status 的话退款买家会被永久当成"已拥有"。
        eq(table.status, 'active')
      )
    )
    .limit(1)
  return Boolean(row)
}

type AssetPriceRow = {
  priceType: string | null
  priceAmount: unknown
  billingModel: string | null
  /** 分成归属要用：收入行的 author_id 与资产归属一致。 */
  authorId: string | null
}

async function loadAsset(kind: AssetKind, assetId: string): Promise<AssetPriceRow | null> {
  if (kind === 'mcp') {
    const [row] = await db
      .select({
        priceType: mcpServers.priceType,
        priceAmount: mcpServers.priceAmount,
        billingModel: mcpServers.billingModel,
        authorId: mcpServers.authorId,
      })
      .from(mcpServers)
      .where(eq(mcpServers.id, assetId))
      .limit(1)
    return row ?? null
  }
  const [row] = await db
    .select({
      priceType: a2aAgents.priceType,
      priceAmount: a2aAgents.priceAmount,
      billingModel: a2aAgents.billingModel,
      authorId: a2aAgents.authorId,
    })
    .from(a2aAgents)
    .where(eq(a2aAgents.id, assetId))
    .limit(1)
  return row ?? null
}

export type PurchaseResult =
  | { ok: true; alreadyOwned: boolean; entitlementId: string; amount: string; currency: string; balanceAfter: string }
  | {
      ok: false
      code:
        | 'NOT_FOUND'
        | 'NOT_LISTED'
        | 'NOT_PAID'
        | 'NOT_PURCHASABLE'
        | 'NO_PRICE'
        | 'UNSUPPORTED_BILLING'
        | 'NEED_RECHARGE'
      error: string
      needRecharge?: boolean
      rechargeUrl?: string
      requiredAmount?: string
      balance?: string
    }

/**
 * 一次性付费资产的购买：从钱包余额扣款并写入授权。
 *
 * 与 `createSkillPurchase` 保持同一套钱包语义（`amount` 是当前余额，
 * `amountSpend` 累加支出，`amountTotal` 递减），这样对账时两种资产能用
 * 同一份查询。
 *
 * 扣款是带 `WHERE amount >= price` 的条件 UPDATE，而不是"先 SELECT 出余额、
 * 在 JS 里比较、再无条件 UPDATE"：后者在并发下会超扣（两个请求都读到 100，
 * 都认为够付 80，最终余额 -60）。
 *
 * 分成在事务**提交之后**由 `creditAssetPurchaseEarning` 记，失败只写日志、
 * 不回滚买家授权。买家已经付了钱也拿到了授权，因为入账失败再去扣他的授权或
 * 退他的钱，比创作者少一笔收入伤害大得多；代价是失败日志必须能用于补账。
 *
 * `pay_per_call` 不走这里：钱在 `settleGatewaySpend` 里随调用扣，所以既不写
 * 授权行也不写销售分成，而是走网关调用分成路径。
 */
export async function purchaseAsset(params: {
  userId: string
  kind: AssetKind
  assetId: string
}): Promise<PurchaseResult> {
  const asset = await loadAsset(params.kind, params.assetId)
  if (!asset) return { ok: false, code: 'NOT_FOUND', error: '资产未找到' }

  // 只接受市场上真正在售的：软删除或连接不在线的资产不该能被购买 ——
  // 买了装不上是最差的用户体验。价格校验放在这条之后，避免泄露下架资产的价格。
  const visible = await isMarketVisible(params.kind, params.assetId)
  if (!visible) return { ok: false, code: 'NOT_LISTED', error: '该资产当前不可购买' }

  if (asset.priceType !== 'paid') {
    return { ok: false, code: 'NOT_PAID', error: '该资产为免费，无需购买' }
  }

  const billingModel = (asset.billingModel ?? '').trim().toLowerCase()

  // 按次付费没有"购买"这一步：钱随调用收。在这里扣一笔固定价格会和调用结算
  // 重复收费，所以明确拒绝而不是默默跳过。
  if (METERED.has(billingModel)) {
    return {
      ok: false,
      code: 'NOT_PURCHASABLE',
      error: '该资产按调用计费，无需购买，安装后直接按量付费',
    }
  }

  if (!ONE_TIME_ONLY.has(billingModel)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_BILLING',
      error: '该资产按订阅计费，订阅购买尚未上线',
    }
  }

  const amountStr = asset.priceAmount?.toString() ?? ''
  const amount = Number(amountStr)
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, code: 'NO_PRICE', error: '该资产价格配置无效' }
  }
  const currency = await loadCurrency(params.kind, params.assetId)

  const table = params.kind === 'mcp' ? mcpServerEntitlements : a2aAgentEntitlements
  const idColumn = params.kind === 'mcp' ? mcpServerEntitlements.mcpServerId : a2aAgentEntitlements.a2aAgentId

  const [existing] = await db
    .select()
    .from(table)
    .where(and(eq(table.userId, params.userId), eq(idColumn, params.assetId)))
    .limit(1)
  if (existing && existing.status === 'active') {
    return {
      ok: true,
      alreadyOwned: true,
      entitlementId: existing.id,
      amount: existing.amount.toString(),
      currency: existing.currency,
      balanceAfter: '0',
    }
  }

  const result = await db.transaction(async (tx) => {
    // 授权行加锁。这一步不是"顺手加的"：`existing` 是在事务外读的，如果两个
    // 请求同时命中一条 `revoked` 行（退款后重新购买），两者都会读到 revoked、
    // 都会认为需要复活、都会扣款。加锁后第二个请求会看到第一个已经把它置回
    // active，直接走上面的 alreadyOwned 语义，而不是再扣一次钱。
    const [locked] = await tx
      .select()
      .from(table)
      .where(and(eq(table.userId, params.userId), eq(idColumn, params.assetId)))
      .limit(1)
      .for('update')

    if (locked?.status === 'active') {
      const [bal] = await tx
        .select({ amount: balances.amount })
        .from(balances)
        .where(eq(balances.userId, params.userId))
        .limit(1)
      return {
        ok: true as const,
        alreadyOwned: true,
        entitlementId: locked.id,
        amount: locked.amount.toString(),
        currency: locked.currency,
        balanceAfter: bal?.amount?.toString() ?? '0',
      }
    }

    const [bal] = await tx
      .select()
      .from(balances)
      .where(eq(balances.userId, params.userId))
      .limit(1)
    if (!bal) {
      return {
        ok: false as const,
        code: 'NEED_RECHARGE' as const,
        error: '余额不足，请先充值',
        needRecharge: true,
        rechargeUrl: '/dashboard/recharge',
        requiredAmount: amountStr,
        balance: '0',
      }
    }

    // 扣款和余额判断合成一条带条件的 UPDATE，而不是"先 SELECT 出余额、在 JS
    // 里比较、再无条件 UPDATE"。后者在并发下会超扣：两个请求都读到余额 100，
    // 都认为够付 80，于是各扣 80，余额变成 -60 —— 相当于凭空造出 60 的负数
    // 余额。`amount >= price` 这个条件由数据库在写锁内判定，第二个请求的
    // 更新会命中 0 行。
    const debited = await tx
      .update(balances)
      .set({
        amount: sql`${balances.amount} - ${amountStr}::numeric`,
        amountSpend: sql`${balances.amountSpend} + ${amountStr}::numeric`,
        amountTotal: sql`${balances.amountTotal} - ${amountStr}::numeric`,
        updatedAt: new Date(),
      })
      .where(and(eq(balances.userId, params.userId), sql`${balances.amount} >= ${amountStr}::numeric`))

    if (Number(debited.rowCount ?? 0) === 0) {
      return {
        ok: false as const,
        code: 'NEED_RECHARGE' as const,
        error: '余额不足，请先充值',
        needRecharge: true,
        rechargeUrl: '/dashboard/recharge',
        requiredAmount: amountStr,
        balance: bal.amount.toString(),
      }
    }

    const orderId = createId()
    const entitlementId = locked?.id ?? createId()

    if (locked) {
      // 唯一约束 (userId, assetId) 不允许第二行，所以退款后重新购买要复用
      // 原行并复活。退款痕迹已经记在 clawback 收入行和账单里，这里清空
      // 是为了让这一行只描述"当前这次购买"。
      await tx
        .update(table)
        .set({
          orderId,
          amount: amountStr,
          currency,
          status: 'active',
          revokedAt: null,
          revocationReason: null,
          refundedAmount: null,
          refundedAt: null,
          refundedBy: null,
          createdAt: new Date(),
        } as never)
        .where(eq(table.id, locked.id))
    } else {
      await tx.insert(table).values({
        id: entitlementId,
        userId: params.userId,
        ...(params.kind === 'mcp'
          ? { mcpServerId: params.assetId }
          : { a2aAgentId: params.assetId }),
        orderId,
        amount: amountStr,
        currency,
      } as never)
    }

    const [after] = await tx
      .select({ amount: balances.amount })
      .from(balances)
      .where(eq(balances.userId, params.userId))
      .limit(1)

    return {
      ok: true as const,
      alreadyOwned: false,
      entitlementId,
      amount: amountStr,
      currency,
      balanceAfter: after?.amount?.toString() ?? '0',
    }
  })

  // 分成入账放在事务提交之后，失败不回滚买家授权 —— 与 Skill 侧
  // （`purchase.ts`）同一取舍：买家已经付了钱、也拿到了授权，因为记账失败
  // 再去扣他的授权或退他的钱，比少一条收入行对用户伤害大得多。代价是提供方
  // 会少一笔收入，所以失败必须留下日志以便补账。
  if (result.ok && !result.alreadyOwned && asset.authorId) {
    try {
      await creditAssetPurchaseEarning({
        authorId: asset.authorId,
        buyerUserId: params.userId,
        assetType: params.kind,
        assetId: params.assetId,
        entitlementId: result.entitlementId,
        grossAmount: result.amount,
        currency: result.currency,
      })
    } catch (err) {
      console.error('[asset-purchase] creditAssetPurchaseEarning failed', {
        kind: params.kind,
        assetId: params.assetId,
        entitlementId: result.entitlementId,
        err,
      })
    }
  }

  return result
}

async function isMarketVisible(kind: AssetKind, assetId: string): Promise<boolean> {
  if (kind === 'mcp') {
    const [row] = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, assetId),
          sql`${mcpServers.deletedAt} is null`,
          sql`${mcpServers.status} = 'published'`,
          sql`${mcpServers.connectionStatus} = 'online'`
        )
      )
      .limit(1)
    return Boolean(row)
  }
  const [row] = await db
    .select({ id: a2aAgents.id })
    .from(a2aAgents)
    .where(
      and(
        eq(a2aAgents.id, assetId),
        sql`${a2aAgents.deletedAt} is null`,
        sql`${a2aAgents.status} = 'published'`,
        sql`${a2aAgents.connectionStatus} = 'online'`
      )
    )
    .limit(1)
  return Boolean(row)
}

async function loadCurrency(kind: AssetKind, assetId: string): Promise<string> {
  if (kind === 'mcp') {
    const [row] = await db
      .select({ currency: mcpServers.currency })
      .from(mcpServers)
      .where(eq(mcpServers.id, assetId))
      .limit(1)
    return row?.currency ?? 'CNY'
  }
  const [row] = await db
    .select({ currency: a2aAgents.currency })
    .from(a2aAgents)
    .where(eq(a2aAgents.id, assetId))
    .limit(1)
  return row?.currency ?? 'CNY'
}
