import { NextResponse } from 'next/server'
import { assertCronAuthorized } from '@/lib/cron/authorize'
import {
  autoConfirmOverdueStatements,
  generateStatements,
  statementConfirmDeadline,
  statementGenerateDate,
  settlementPeriodFor,
} from '@/web/providers/statements'

export const dynamic = 'force-dynamic'

/**
 * 创作者月度结算的单一定时入口：出账（次月 5 日）+ 自动确认（19 日截止）。
 *
 * 为什么合成一个路由而不是两个：两件事共享同一套"现在是否该做这步"的判断，
 * 而这套判断只有一个真相来源——`statementGenerateDate` / `statementConfirmDeadline`。
 * 拆开就要让两个外部调度器各自实现一遍日期门槛，迟早会漂移。
 *
 * 两个动作都是幂等的，所以每天跑一次而不是等到 5 日/19 日各跑一次：
 * 漏掉某天不会漏掉账单（次日补上），而"只在 5 日跑"在调度器当天故障时
 * 就整月丢账单。
 *
 * `generateStatements` 只在 5 日及之后聚合**上一个自然月**的收入，因此
 * 6 月 30 日补跑 6 月账不会二次生成 5 月账单——每期的窗口是显式的。
 *
 * Env:
 *   CRON_SECRET - 鉴权，见 `@/lib/cron/authorize`
 *   ?period=YYYY-MM  手动指定出账期（补账用）
 *   ?force=true      跳过日期门槛（补账用）
 */
export async function GET(request: Request) {
  const unauthorized = assertCronAuthorized(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const periodParam = url.searchParams.get('period')
  const force = url.searchParams.get('force') === 'true'
  const now = new Date()

  if (periodParam && !/^\d{4}-\d{2}$/.test(periodParam)) {
    return NextResponse.json({ success: false, error: 'period 必须为 YYYY-MM' }, { status: 400 })
  }

  try {
    const period = periodParam ?? settlementPeriodFor(now)
    const generateGate = statementGenerateDate(period)
    const afterGenerateGate = force || now >= generateGate

    const generated = afterGenerateGate
      ? await generateStatements(now, { period })
      : { period, created: 0, rolled: 0, skipped: 0, errors: [] }

    // 自动确认不看 `force`：`force` 是运维补账用的开关，不该让 19 日没过
    // 的账单提前自动确认——那是把创作者的异议权跳过去。
    const confirmed = await autoConfirmOverdueStatements(now)

    const ok = generated.errors.length === 0 && confirmed.errors.length === 0
    return NextResponse.json({
      success: ok,
      data: {
        period,
        generateGate: generateGate.toISOString(),
        confirmDeadline: statementConfirmDeadline(period).toISOString(),
        generated,
        confirmed,
      },
      timestamp: now.toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron] 账单任务执行失败:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}