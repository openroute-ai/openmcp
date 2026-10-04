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
 */
import { syncEnv } from "@/lib/env"
import { pushSkill } from "@/lib/github/service/push-skill"
import { listSkillsForProject } from "@/lib/github/service/skill"
import type { Db } from "@/lib/github/service/repo"
import type { TaskLogger } from "@/lib/tasks/runner"

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
  /** 覆盖环境变量，测试用。 */
  webhookUrl?: string
  secret?: string
  token?: string
}

/**
 * `null` 表示**没有配置下游地址**，与"配置了但推送失败"是两种不同的结果：
 * 前者不该在响应里报失败（那是部署的事，不是这次调用的），后者要报。
 * 调用方据此决定 `delivered` 是 `false` 还是省略。
 */
export async function deliverProjectSkills(
  db: Db,
  projectId: string,
  deps: DeliverProjectSkillsDeps
): Promise<DeliverProjectSkillsResult | null> {
  const env = syncEnv()
  const webhookUrl = deps.webhookUrl ?? env.SKILLS_WEBHOOK_URL
  if (!webhookUrl) {
    deps.logger.warn("SKILLS_WEBHOOK_URL is not set; skills stored for retry")
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
      {
        webhookUrl,
        secret: deps.secret ?? env.GITHUB_DATA_WEBHOOK_SECRET,
        token: deps.token ?? env.SKILLS_WEBHOOK_TOKEN,
      }
    )

    if (result.pushed) {
      pushed += 1
    } else {
      deps.logger.error(
        `failed to push ${result.fullName} (${result.skillDir}): ${result.summary}`
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
