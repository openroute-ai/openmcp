/**
 * 把一个 project 的全部技能文档同步推给下游 web 服务。
 *
 * 与 `push-skills` 任务的关系必须写清楚，否则下一次有人会以为它们重复了：
 *
 * - `push-skills` 读 `listSkillsNeedingPushJoined`（重试队列），扫的是**全库**里
 *   从未推送成功或上次失败的行。它是兜底，周期跑。
 * - 这里读 `listSkillsForProject`，推的是**这一个 project 的全部行**。它由一次
 *   刚发生的 project 创建触发，因为调用方在等这个结果，不能等下一个周期。
 *
 * 所以重叠是刻意的：队列保证"最终会到"，这里保证"现在就到"。同一行被推两次是安全的，
 * `pushSkill` 记 `syncedToWebAt` 而下游按 `skillDir` + `version` 幂等覆盖。
 *
 * 失败**不抛出**。技能没送到不该让一次成功的 project 创建变成 500：那行已经进了
 * 重试队列，`push-skills` 会接手。用返回值 `delivered === false` 把"存下了但没送到"
 * 交给调用方决定怎么提示。
 *
 * 投递地址取自 project 行（`skillsWebhookUrl` / `skillsWebhookSecret`），也就是提交
 * 那次请求带过来的 `callbackUrl` / `callbackSecret`。曾经这里是读部署级的
 * `SKILLS_WEBHOOK_URL`，现在没有全站地址了：一个 console 可以同时服务多个提交方，
 * 各自的地址跟各自的密钥一起记在自己的行上。
 */
import { pushSkill } from "@/lib/github/service/push-skill"
import { listSkillsForProject } from "@/lib/github/service/skill"
import { getSkillsDestination } from "@/lib/github/service/skill-destination"
import type { Db } from "@/lib/github/service/repo"
import type { TaskLogger } from "@/lib/tasks/runner"
import type { WebhookSender } from "@/lib/tasks/tasks/build-daily-data"

export interface DeliverProjectSkillsResult {
  /** 该 project 存着的技能总数。 */
  found: number
  pushed: number
  failed: number
  /** 下游全盘接受。调用方据此回答"能不能现在就用"。 */
  delivered: boolean
  results: Array<{
    skillDir: string
    pushed: boolean
    summary: string
  }>
}

export interface DeliverProjectSkillsDeps {
  logger: TaskLogger
  /** 覆盖 project 行上的地址，测试用。 */
  destination?: { url: string; secret: string }
  sender?: WebhookSender
}

/**
 * `null` 表示**这个 project 没有投递地址**，与"配了地址但推送失败"是两种不同的
 * 结果：前者不该在响应里报失败（那是提交方的事，不是这次调用的），后者要报。
 * 调用方据此决定 `delivered` 是 `false` 还是省略。
 */
export async function deliverProjectSkills(
  db: Db,
  projectId: string,
  deps: DeliverProjectSkillsDeps
): Promise<DeliverProjectSkillsResult | null> {
  const destination = deps.destination ?? (await getSkillsDestination(db, projectId))
  if (!destination) {
    deps.logger.warn(
      "project has no skills destination; skills stored for retry"
    )
    return null
  }

  const stored = await listSkillsForProject(db, projectId)
  if (stored.length === 0) {
    return { found: 0, pushed: 0, failed: 0, delivered: true, results: [] }
  }

  const results: DeliverProjectSkillsResult["results"] = []
  let pushed = 0

  for (const skill of stored) {
    const result = await pushSkill(
      db,
      { projectId, skillDir: skill.skillDir },
      { webhookUrl: destination.url, secret: destination.secret, sender: deps.sender }
    )

    if (result.pushed) {
      pushed += 1
    } else {
      deps.logger.error(
        `failed to push ${result.fullName} (${skill.skillDir}): ${result.summary}`
      )
    }

    results.push({
      skillDir: result.skillDir,
      pushed: result.pushed,
      summary: result.summary,
    })
  }

  return {
    found: stored.length,
    pushed,
    failed: stored.length - pushed,
    delivered: pushed === stored.length,
    results,
  }
}
