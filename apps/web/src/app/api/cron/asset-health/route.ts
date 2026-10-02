import { NextResponse } from 'next/server'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import { runScheduledHealthChecks } from '@/lib/health-check/scheduled-check'

export const dynamic = 'force-dynamic'

/**
 * 资产健康检查的手动/外部调度入口。
 *
 * 和 `local-cron.ts` 里的 `asset-health-check` 是同一个函数、同一套阈值：
 * 外部调度器（K8s CronJob、systemd timer、另一台机器上的 cron）只需要一个 HTTP
 * 入口，不必依赖目标进程里恰好跑着内置调度器。两边同时开着也只是多跑几轮探测，
 * 不会重复写入错误状态——写库是幂等的 upsert 语义（按 id 更新同一行）。
 *
 * 返回 200 而不是在有资产失败时返回 5xx：探测失败是**被观测对象**的状态，不是
 * 这个接口自己出错。让调度器把「有 3 个资产挂了」当成接口故障去告警/重试，只会
 * 刷出一堆重试风暴，真正的资产问题反而被埋掉。因此 `success` 只反映这个接口能否
 * 完成，资产健康度在 `summaries` 里逐条给出。
 *
 * Env:
 *   CRON_SECRET - 鉴权，见 `@/lib/cron/authorize`
 *   HEALTH_CHECK_FAIL_THRESHOLD - 连续失败几次才下架（默认 3）
 *   HEALTH_CHECK_CONCURRENCY - 单轮并发探测数（默认 5）
 */
export async function GET(request: Request) {
  const unauthorized = assertCronAuthorized(request)
  if (unauthorized) return unauthorized

  try {
    const summaries = await runScheduledHealthChecks()
    return NextResponse.json({
      success: true,
      summaries,
      takenOffline: summaries.reduce((n, s) => n + s.takenOffline, 0),
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '健康检查执行失败',
      },
      { status: 500 }
    )
  }
}