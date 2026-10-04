/**
 * 订阅投递（设计文档 §6.3 / §6.4 / §6.5）。
 *
 * 三条不变量，全部由这一层负责：
 *
 * 1. **水位线只在成功时前进。** 失败不动它，所以重试会重发同一批（同一 `eventId`、
 *    同一 payload 字节），既不跳数据也不重复计入已投递的部分。
 * 2. **多段投递只有最后一段成功才推进水位线。** 第 1 段成功、第 2 段失败时只重发
 *    第 2 段，第 1 段不会被重复投递（§6.5）。
 * 3. **熔断不做「永不」**：连续失败到 20 次就停（§6.4）。永远失败的订阅会把 cron 的
 *    时间预算吃光，连带影响其他订阅。
 *
 * 投递**先落库再发**。顺序不能反：一个只在内存里的 payload 在进程崩溃后就消失了，而
 * 崩溃之后水位线也没有推进——于是那批数据既没送达、也没被记住要重发。
 */
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import {
  subscriptions,
  webhookDeliveries,
  type SubscriptionRow,
} from "@/db/schema/subscriptions"
import {
  deriveSigningKey,
  resolveOwnerUserId,
  toFilters,
} from "@/lib/api/subscriptions"
import {
  buildPayload,
  buildTestPayload,
  payloadBytes,
  segmentPayload,
  type DeliveryPayload,
} from "@/lib/api/subscription-payload"
import {
  listFilteredRepos,
  loadMatchReasons,
} from "@/lib/api/repo-filter"
import { toStatsCadence } from "@/lib/api/stats"
import { latestPeriodForRepos } from "@/lib/github/service/stats"
import type { Db } from "@/lib/github/service/repo"
import { sendWebhook } from "@/lib/webhook/client"

/**
 * `Db = Database | Tx`（`service/repo.ts`），而不是 `typeof dbClient`。
 *
 * 收窄到事务对象，是为了让这些函数能同时被 HTTP 路由（连接）与投递任务（runner 给的
 * 事务）调用。反过来放宽到 `typeof dbClient` 会让投递任务编译不过，而它的 `db` 来自
 * `TaskContext`。
 */
type Database = Db

/** 退避表（§6.4）：`1s → 5s → 30s → 5min → 30min`。 */
const BACKOFF_MS = [1_000, 5_000, 30_000, 5 * 60_000, 30 * 60_000]

/** 最多 8 次尝试，之后 `status = "failed"`（§6.4）。 */
export const MAX_ATTEMPTS = 8

/** 连续失败到这条线就熔断（§6.4）。 */
export const CIRCUIT_BREAKER_THRESHOLD = 20

/** 一次投递的 HTTP 超时。与 `sendWebhook` 的默认一致。 */
const DELIVERY_TIMEOUT_MS = 10_000

export interface DeliveryLogger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export interface SubscriptionRunResult {
  id: string
  /** 没有生成任何 delivery 时的原因。有 delivery 时为 undefined。 */
  skipped?: "disabled" | "expired" | "no_match" | "no_new_data" | "mode_snapshot_never"
  parts: number
  delivered: number
  failed: number
  watermark: Date | null
}

function backoffFor(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1
  return BACKOFF_MS[index]!
}

/**
 * 跑一条订阅：算集合 → 组 payload → 分段 → 落库 → 按段投递。
 *
 * **不重试**：重试由 {@link retryDueDeliveries} 在下一轮 cron 里做（§6.4 的退避表要跨
 * 任务运行才走得完，而一个任务的时间预算不该花在睡 30 分钟上）。
 */
export async function deliverSubscription(
  db: Database,
  subscription: SubscriptionRow,
  now: Date,
  logger: DeliveryLogger
): Promise<SubscriptionRunResult> {
  const base: SubscriptionRunResult = {
    id: subscription.id,
    parts: 0,
    delivered: 0,
    failed: 0,
    watermark: null,
  }

  if (!subscription.enabled) return { ...base, skipped: "disabled" }
  if (subscription.expiresAt && subscription.expiresAt <= now) {
    return { ...base, skipped: "expired" }
  }

  const filters = toFilters(subscription)
  const ownerUserId = await resolveOwnerUserId(db, subscription)
  const rows = await listFilteredRepos(db as Db, filters, ownerUserId)

  // 命中为空：既不推进也不回退水位线（§6.4）。把水位线退到一个空集合的起点，等于让
  // 下一次投递把整张表重推一遍。
  if (rows.length === 0) {
    logger.info("[subscriptions] no matched repos", { id: subscription.id })
    return { ...base, skipped: "no_match" }
  }

  const cadence = toStatsCadence(subscription.cadence)
  const repoIds = rows.map((row) => row.id)

  // batch 才有水位线。首次为 null 时「取所有已存周期的起点」（§6.4 第 1 步）由
  // `listStatsSince` 对 null 的处理直接给出，不必预先查一次最早周期。
  let watermark: Date | null = null
  let nextWatermark: Date | null = null
  if (subscription.mode === "batch") {
    watermark = subscription.watermark
    nextWatermark = await latestPeriodForRepos(db as Db, cadence, repoIds)
    // 没有新数据就不生成 delivery。推进一个空批次等于凭空多发一次空事件。
    if (!nextWatermark || (watermark && nextWatermark <= watermark)) {
      return { ...base, skipped: "no_new_data" }
    }
  }

  const matchReasons = await loadMatchReasons(db as Db, filters, rows, ownerUserId)
  const payload = await buildPayload(db as Db, {
    subscription,
    rows,
    matchReasons,
    ownerUserId,
    watermark,
    nextWatermark,
    now,
  })
  const parts = segmentPayload(payload, subscription.id)

  // 先落库再发。见文件头：不落库就等于这批数据没人记得要重发。
  const deliveries = await insertDeliveries(db, subscription, parts)

  let delivered = 0
  let failed = 0
  for (const [index, part] of parts.entries()) {
    const row = deliveries[index]!
    const outcome = await attemptDelivery(db, subscription, row!.id, part, {
      eventId: part.eventId,
      event: part.event,
    })
    if (outcome.delivered) delivered += 1
    else failed += 1

    // 中途失败就停：后面的段带着同一个水位线，发出去只会让消费方收到一批不完整的数据。
    // §6.5 说「第 1 段成功、第 2 段失败时只重发第 2 段」，靠的就是这个提前返回。
    if (!outcome.delivered) break
  }

  logger.info("[subscriptions] delivered", {
    id: subscription.id,
    parts: parts.length,
    delivered,
    failed,
    watermark: nextWatermark?.toISOString() ?? null,
  })

  return { ...base, parts: parts.length, delivered, failed, watermark: nextWatermark }
}

/**
 * 落库这一批的每一段。
 *
 * `watermark` 存**整批**的目标水位线而不是每段各自的：判断「我是不是最后一段」需要
 * 拿到同批的其他段，而它们唯一能对齐的字段就是它。`attempt = 1` 与 `status = "pending"`
 * 是列默认值，写出来是为了让这段代码在任何一次阅读里都能看到「投递在库里长什么样」。
 */
async function insertDeliveries(
  db: Database,
  subscription: SubscriptionRow,
  parts: DeliveryPayload[]
): Promise<{ id: string }[]> {
  const watermark = parts[0]?.watermark ? new Date(parts[0].watermark) : new Date()

  const inserted = await db
    .insert(webhookDeliveries)
    .values(
      parts.map((part) => ({
        id: `dlv_${randomBytes(12).toString("base64url")}`,
        subscriptionId: subscription.id,
        eventId: part.eventId,
        event: part.event,
        payload: JSON.parse(payloadBytes(part)),
        // snapshot 模式没有水位线语义，但仍要 NOT NULL，所以记「这一批生成的时间」。
        // 它只用于把同批的几段对齐，不参与推进。
        watermark,
        attempt: 1,
        status: "pending" as const,
      }))
    )
    .returning({ id: webhookDeliveries.id })

  return inserted
}

/**
 * 发一段并记账。
 *
 * 成功且**同批没有别的段还没成功**时推进水位线。这是「只有最后一段成功才推进」的实现：
 * 「最后一段」不落成一个列，而是从同批的其他 delivery 的状态推出来——于是重试路径
 * （`retryDueDeliveries`）与首次投递走的是同一段代码，不会出现「首次投递会推进、重试
 * 不会」这种只在失败场景下才暴露的差异。
 */
async function attemptDelivery(
  db: Database,
  subscription: SubscriptionRow,
  deliveryId: string,
  payload: DeliveryPayload,
  meta: { eventId: string; event: string }
): Promise<{ delivered: boolean; status?: number; error?: string }> {
  const result = await sendOne(db, subscription, payload, meta)

  const [row] = await db
    .select({ attempt: webhookDeliveries.attempt })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)
  const attempt = row?.attempt ?? 1

  if (result.delivered) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        httpStatus: result.status ?? null,
        error: null,
        deliveredAt: sql`now()`,
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    await advanceWatermarkIfLastPart(db, subscription, deliveryId)
    return result
  }

  const exhausted = attempt >= MAX_ATTEMPTS
  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? ("failed" as const) : ("pending" as const),
      httpStatus: result.status ?? null,
      error: result.error ?? null,
      attempt: attempt + 1,
      nextAttemptAt: exhausted
        ? sql`now()`
        : new Date(Date.now() + backoffFor(attempt)),
    })
    .where(eq(webhookDeliveries.id, deliveryId))

  // 熔断计数在**投递失败**时加，不在重试排期时加（§6.4）：排期只是一条记录，
  // 真正说明「对方收不到」的是这一次失败。
  const failures = subscription.consecutiveFailures + 1
  await db
    .update(subscriptions)
    .set({
      consecutiveFailures: failures,
      lastError: result.error ?? null,
      // 到了线就停，队列保留（§6.4）。消费方修好后 PATCH 恢复。
      ...(failures >= CIRCUIT_BREAKER_THRESHOLD
        ? { enabled: false, disabledReason: "too_many_failures" as const }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(subscriptions.id, subscription.id))

  return result
}

/**
 * 同批的段都成功了才推进水位线。
 *
 * 「同批」= 同一个 `subscription_id` + 同一个 `watermark`。snapshot 模式不推进：它没有
 * 增量语义，推进了只会让下一次 snapshot 从更晚的地方开始读，而 snapshot 的定义是
 * 「每次推当前状态」（§6.4）。
 */
async function advanceWatermarkIfLastPart(
  db: Database,
  subscription: SubscriptionRow,
  deliveryId: string
): Promise<void> {
  if (subscription.mode !== "batch") return

  const [current] = await db
    .select({ watermark: webhookDeliveries.watermark })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)
  if (!current) return

  const [pendingSibling] = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.subscriptionId, subscription.id),
        eq(webhookDeliveries.watermark, current.watermark),
        sql`${webhookDeliveries.id} <> ${deliveryId}`,
        sql`${webhookDeliveries.status} <> 'delivered'`
      )
    )
    .limit(1)
  if (pendingSibling) return

  await db
    .update(subscriptions)
    .set({
      watermark: current.watermark,
      lastDeliveredAt: sql`now()`,
      // 任何一次成功都清零（§6.4）。不清零的话一个间歇性失败的订阅会靠累计值触发熔断，
      // 而它的失败其实早就被后续成功覆盖了。
      consecutiveFailures: 0,
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(eq(subscriptions.id, subscription.id))
}

/** 发一段。签名密钥由 `secret_hash` 派生，见 `deriveSigningKey` 的注释。 */
async function sendOne(
  db: Database,
  subscription: SubscriptionRow,
  payload: DeliveryPayload,
  meta: { eventId: string; event: string }
): Promise<{ delivered: boolean; status?: number; error?: string }> {
  const [row] = await db
    .select({ secretHash: subscriptions.secretHash })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscription.id))
    .limit(1)
  if (!row) return { delivered: false, error: "subscription disappeared" }

  try {
    const [result] = await sendWebhook([subscription.callbackUrl], payload, {
      secret: deriveSigningKey(row.secretHash),
      eventId: meta.eventId,
      event: meta.event,
      timeoutMs: DELIVERY_TIMEOUT_MS,
    })
    if (!result) return { delivered: false, error: "no result" }
    return result.success
      ? { delivered: true, status: result.status }
      : { delivered: false, status: result.status, error: result.error }
  } catch (error) {
    return {
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 重试到期的 pending 段（§6.4 的退避表）。
 *
 * `limit` 是给 cron 的时间预算留的闸：一个订阅积压了几百段时，不加限制就会把整轮任务
 * 的时间吃光，别的订阅连第一次投递都轮不到。剩下的留给下一轮。
 *
 * 只按 `next_attempt_at` 排序而不是按创建时间：退避表的意义就是让早到期的那批先走。
 */
export async function retryDueDeliveries(
  db: Database,
  now: Date,
  logger: DeliveryLogger,
  limit = 50
): Promise<{ retried: number; delivered: number; failed: number }> {
  const due = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        lte(webhookDeliveries.nextAttemptAt, now)
      )
    )
    .orderBy(webhookDeliveries.nextAttemptAt)
    .limit(limit)

  let delivered = 0
  let failed = 0

  for (const { id } of due) {
    const outcome = await retryOne(db, id, logger)
    if (outcome) delivered += 1
    else failed += 1
  }

  return { retried: due.length, delivered, failed }
}

async function retryOne(
  db: Database,
  deliveryId: string,
  logger: DeliveryLogger
): Promise<boolean> {
  const [row] = await db
    .select({
      eventId: webhookDeliveries.eventId,
      event: webhookDeliveries.event,
      payload: webhookDeliveries.payload,
      attempt: webhookDeliveries.attempt,
      subscription: subscriptions,
    })
    .from(webhookDeliveries)
    .innerJoin(subscriptions, eq(subscriptions.id, webhookDeliveries.subscriptionId))
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1)
  if (!row) return false

  // 重发的是**落库的那一份字节**，不是重新组装的：重新组装会改键序，于是同一个
  // `eventId` 带出不同的签名，接收方的 300s 重放窗口会拒掉第二次（§6.5）。
  const payload = row.payload as DeliveryPayload
  const result = await sendOne(db, row.subscription, payload, {
    eventId: row.eventId,
    event: row.event,
  })

  // 重读一次订阅而不是用 join 出来的那份：熔断计数是**读改写**，而这一轮投递期间
  // 可能已经有别的路径（管理员 disable、另一次投递）改过它。用旧值覆盖回去会把那次改动
  // 悄悄撤销。
  const subscription = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, row.subscription.id))
    .limit(1)
  const current = subscription[0]
  const attempt = row.attempt

  if (result.delivered) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "delivered",
        httpStatus: result.status ?? null,
        error: null,
        deliveredAt: sql`now()`,
      })
      .where(eq(webhookDeliveries.id, deliveryId))

    if (current) {
      await advanceWatermarkIfLastPart(db, current, deliveryId)
    }
    logger.info("[subscriptions] retry delivered", { eventId: row.eventId })
    return true
  }

  // `failed` 是终态（§6.4）：水位线不动，下一轮 cron 会用**新的** `eventId` 重新生成
  // 一批，漏掉的数据会在那一批里补上。
  await db
    .update(webhookDeliveries)
    .set({
      status: attempt >= MAX_ATTEMPTS ? ("failed" as const) : ("pending" as const),
      httpStatus: result.status ?? null,
      error: result.error ?? null,
      attempt: attempt + 1,
      nextAttemptAt: new Date(Date.now() + backoffFor(attempt)),
    })
    .where(eq(webhookDeliveries.id, deliveryId))

  if (current) {
    const failures = current.consecutiveFailures + 1
    await db
      .update(subscriptions)
      .set({
        consecutiveFailures: failures,
        lastError: result.error ?? null,
        ...(failures >= CIRCUIT_BREAKER_THRESHOLD
          ? { enabled: false, disabledReason: "too_many_failures" as const }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(subscriptions.id, current.id))
  }

  logger.warn("[subscriptions] retry failed", {
    eventId: row.eventId,
    attempt,
    status: result.status,
    error: result.error,
  })
  return false
}

/**
 * `POST /api/v1/subscriptions/{id}/test` 的一次性投递（§6.8）。
 *
 * 与正常投递的差别只有两处：事件名是 `subscription.test`，且**不推进水位线**——它的用途
 * 是改过滤器时立刻验证地址可达、签名能过，而不是补数据。鉴权与签名路径完全一致，所以
 * 测试能验签通过，正常事件也能。
 */
export async function sendTestDelivery(
  db: Database,
  subscription: SubscriptionRow,
  now: Date,
  logger: DeliveryLogger
): Promise<{
  eventId: string
  delivered: boolean
  httpStatus: number | null
  error: string | null
  deliveredAt: string
}> {
  const ownerUserId = await resolveOwnerUserId(db, subscription)
  const rows = (await listFilteredRepos(db as Db, toFilters(subscription), ownerUserId)).slice(
    0,
    5
  )
  const matchReasons = await loadMatchReasons(
    db as Db,
    toFilters(subscription),
    rows,
    ownerUserId
  )

  const payload = buildTestPayload(
    subscription,
    now,
    (
      await buildPayload(db as Db, {
        subscription,
        rows,
        matchReasons,
        ownerUserId,
        watermark: null,
        nextWatermark: null,
        now,
      })
    ).repos
  )

  // 落一条记录，这样订阅方在 `GET /api/v1/subscriptions/{id}` 里能看到自己那次测试
  // 的结果（§6.8 的排障入口）。它同样不推进水位线。
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      id: `dlv_${randomBytes(12).toString("base64url")}`,
      subscriptionId: subscription.id,
      eventId: payload.eventId,
      event: payload.event,
      payload: JSON.parse(payloadBytes(payload)),
      watermark: now,
      attempt: 1,
      status: "pending" as const,
    })
    .returning({ id: webhookDeliveries.id })

  const result = await attemptDelivery(db, subscription, row!.id, payload, {
    eventId: payload.eventId,
    event: payload.event,
  })

  logger.info("[subscriptions] test delivery", {
    id: subscription.id,
    delivered: result.delivered,
    status: result.status,
  })

  return {
    eventId: payload.eventId,
    delivered: result.delivered,
    httpStatus: result.status ?? null,
    error: result.error ?? null,
    deliveredAt: now.toISOString(),
  }
}

/**
 * 全部启用的订阅（投递任务的入口）。
 *
 * 部分索引 `subscriptions_enabled_idx` 只覆盖 `enabled = true` 的行，所以这个扫描不碰
 * 被熔断的订阅；`expiresAt` 在这里过滤而不是在每条订阅里判，因为过期的订阅连 payload
 * 都不该组装。
 */
export async function listDeliverableSubscriptions(
  db: Database,
  now: Date
): Promise<SubscriptionRow[]> {
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.enabled, true),
        // `expiresAt` 可空，所以是「没过期 或 过期时间在未来」。过期的订阅连 payload
        // 都不该组装，所以在 SQL 里滤掉而不是逐条判。
        or(isNull(subscriptions.expiresAt), gt(subscriptions.expiresAt, now))
      )
    )
    .orderBy(subscriptions.createdAt, subscriptions.id)
}

/** 给重试路径用的辅助：某条订阅上还没送达的段数，排障时看这个。 */
export async function countPendingDeliveries(
  db: Database,
  subscriptionId: string
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.subscriptionId, subscriptionId),
        eq(webhookDeliveries.status, "pending")
      )
    )

  return row?.value ?? 0
}
