/**
 * 投递订阅（设计文档 §6.3）。
 *
 * **独立任务，而不是排行任务尾部的一行调用**：任务框架已经有 `taskDefinitions` /
 * `taskExecutions` 的调度、重入保护（`task.alreadyRunning`）与历史，混进行情任务会让
 * 「排行失败」与「推送失败」共用一条执行记录，运维看不出是哪一环坏了。
 *
 * 排在两个排行任务之后（`definitions.ts` 的 `TASK_SEEDS` 顺序即依赖顺序）：需求的核心
 * 约束是「console 拉完全部排行数据之后，再把更新的数据推给订阅者」。若在
 * `update-github-data` 之后就推，接收方拿到的排行会缺尚未闭合的周期。
 *
 * 一轮做两件事：
 *
 * 1. 重试到期的 pending 段（§6.4 的退避表）。**必须每轮都做**，而不是只在有新数据时
 *    做：一条只失败过一次的订阅在没有新数据的那一天里也该收到重试，否则退避表实际
 *    变成了「下次有新数据时才重试」。
 * 2. 为每条启用的订阅生成并投递新的一批。
 */

import {
  deliverSubscription,
  listDeliverableSubscriptions,
  retryDueDeliveries,
  type DeliveryLogger,
} from "@/lib/api/subscription-delivery"
import type { Task } from "@/lib/tasks/runner"

export interface NotifySubscriptionsOptions {
  now?: () => Date
  /** 一轮里最多重试多少段。给 cron 的时间预算留闸，见 `retryDueDeliveries`。 */
  retryLimit?: number
}

export function createNotifySubscriptionsTask(
  options: NotifySubscriptionsOptions = {}
): Task {
  const now = options.now ?? (() => new Date())
  const retryLimit = options.retryLimit ?? 50

  return {
    name: "notify-subscriptions",
    description: "Deliver queued subscription webhooks and retry failed deliveries",

    async run({ db, logger }) {
      const at = now()

      const retried = await retryDueDeliveries(
        db,
        at,
        logger as DeliveryLogger,
        retryLimit
      )
      if (retried.retried > 0) {
        logger.info(
          `retried ${retried.retried} pending deliveries: ` +
            `${retried.delivered} delivered, ${retried.failed} still failing`
        )
      }

      const subscriptions = await listDeliverableSubscriptions(db, at)
      if (subscriptions.length === 0) {
        return {
          subscriptions: 0,
          deliveries: 0,
          delivered: 0,
          failed: 0,
          retried: retried.retried,
        }
      }

      let deliveries = 0
      let delivered = 0
      let failed = 0
      const skipped: Record<string, number> = {}

      // 顺序而不是并发：投递是有配额的外呼，并发会把一个订阅的十段同时打出去，既没有
      // 段间的顺序保证，也会让退避与熔断的计数在并发写下互相覆盖。
      for (const subscription of subscriptions) {
        const result = await deliverSubscription(
          db,
          subscription,
          at,
          logger as DeliveryLogger
        )
        deliveries += result.parts
        delivered += result.delivered
        failed += result.failed
        if (result.skipped) {
          skipped[result.skipped] = (skipped[result.skipped] ?? 0) + 1
        }
      }

      logger.info(
        `delivered to ${subscriptions.length} subscriptions: ` +
          `${delivered}/${deliveries} parts`
      )

      return {
        subscriptions: subscriptions.length,
        deliveries,
        delivered,
        failed,
        retried: retried.retried,
        retriedDelivered: retried.delivered,
        ...(Object.keys(skipped).length > 0 ? { skipped } : {}),
      }
    },
  }
}