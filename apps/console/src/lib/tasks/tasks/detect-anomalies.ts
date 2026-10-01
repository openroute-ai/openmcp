/**
 * 跑一遍异动判定，把命中的结论物化进 `repo_anomalies`。
 *
 * 这个任务**不发任何 GitHub 请求**。它读的是 stats 表、`repos` 和
 * `repo_license_history`——三样都已经被早它运行的任务写好了。这不是巧合，而是
 * §5.4 那条「零新增请求」约束的直接结果：异动流必须是**已有采集的副产品**，
 * 否则它每天要花的预算会比它产出的结论更值钱。
 *
 * 因此它在 07:30 而不是 02:00 跑：它需要当天刷新的仓库信息（`pushed_at`、
 * `license_spdx_id`、`latest_release_published_at`）和至少一个已经落库的完整周
 * （`snapshot-stars` 05:00 写）。早于这两个任务的任何时刻，它读到的是昨天的数据，
 * 而结论里写着今天的日期。
 *
 * 幂等：`recordHits` 的 `ON CONFLICT DO NOTHING` 让重跑不产生新行。所以这个任务
 * 失败之后可以直接重跑，不需要先清理上一次的结果——而这一点是刻意的，因为「清理」
 * 会把一个「重跑是安全的」的系统变成一个「重跑有风险」的系统。
 */

import {
  detectAndRecord,
  falsePositiveRate,
  listDetectableRepoIds,
} from "@/lib/radar/anomalies"
import type { Task } from "@/lib/tasks/runner"

/** 一次判定覆盖的仓库上限，防止一次失控的回填把整张表写满。 */
const MAX_REPOS = 5_000

/** 回看多少天的误报率，用于回答「最近这段时间我们报的东西有多少是错的」。 */
const FALSE_POSITIVE_WINDOW_DAYS = 30

const MS_PER_DAY = 86_400_000

export interface DetectAnomaliesOptions {
  /** 注入时钟，便于回填与测试。 */
  now?: () => Date
  /** 每批多少个仓库。 */
  chunk?: number
}

export function createDetectAnomaliesTask(
  options: DetectAnomaliesOptions = {}
): Task {
  const now = options.now ?? (() => new Date())
  const chunk = options.chunk ?? 250

  return {
    name: "detect-anomalies",
    description:
      "Evaluate the radar rules against stored stats and materialise " +
      "the anomalies that fired",

    async run({ db, logger }) {
      const at = now()
      const repoIds = await listDetectableRepoIds(db, MAX_REPOS)

      if (repoIds.length === 0) {
        // 不是失败：没有周统计就意味着还没有任何星标历史可判，而那通常是采集
        // 侧的问题，不是这个任务的。把它报成 error 只会让告警指向错的地方。
        logger.warn("no repository has weekly stats yet; nothing to evaluate")
        return { repos: 0, detected: 0, skipped: 0 }
      }

      let detected = 0

      // 分批而不是一次全量：判定是纯计算，写入才是有重量的部分，而一次几千行的
      // INSERT 会让一次失败丢掉全部进展。批次让失败可以重跑——重跑安全，因为
      // `recordHits` 幂等（见本文件的说明）。
      for (let start = 0; start < repoIds.length; start += chunk) {
        const batch = repoIds.slice(start, start + chunk)
        const inserted = await detectAndRecord(db, batch, at)
        detected += inserted
        logger.info(
          `evaluated ${Math.min(start + chunk, repoIds.length)}/${repoIds.length} repositories, ${detected} new anomalies`
        )
      }

      // 误报率在这里被读出来而不是等到有人想起来看：它是 §9.2 里唯一需要在有人
      // 去改阈值之前就看见的数，而一个只在仪表盘角落里的数没人会去读。
      const fp = await falsePositiveRate(
        db,
        new Date(at.getTime() - FALSE_POSITIVE_WINDOW_DAYS * MS_PER_DAY)
      )

      return {
        repos: repoIds.length,
        detected,
        openAnomalies: fp.total - fp.dismissed,
        falsePositiveRate: fp.rate,
        windowDays: FALSE_POSITIVE_WINDOW_DAYS,
      }
    },
  }
}
