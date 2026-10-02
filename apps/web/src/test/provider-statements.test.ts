/**
 * 结算日历的纯日期逻辑。
 *
 * 只测纯函数：出账/确认/打款日期一旦偏一个月，账单就会在收入还没发生完
 * 时生成并立刻被自动确认，所以这个偏移必须是可测的、而不是"看代码觉得对"。
 */

import { describe, expect, it } from 'vitest'
import {
  periodBefore,
  periodOf,
  settlementPeriodFor,
  statementConfirmDeadline,
  statementGenerateDate,
  statementPayoutDate,
  statementTimeline,
} from '../web/providers/statements'

describe('periodOf / periodBefore / settlementPeriodFor', () => {
  it('formats in UTC, not local time', () => {
    // 2026-03-31T23:30Z 在 UTC+8 已是 4 月 1 日。用 UTC 是因为账单日历
    // 只有一个全球定义；用本地时区会让不同时区的创作者拿到不同账单日。
    expect(periodOf(new Date('2026-03-31T23:30:00Z'))).toBe('2026-03')
    expect(periodOf(new Date('2026-03-31T16:00:00Z'))).toBe('2026-03')
  })

  it('zero-pads the month', () => {
    expect(periodOf(new Date('2026-01-15T00:00:00Z'))).toBe('2026-01')
    expect(periodOf(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09')
  })

  it('steps back one month, rolling the year over in January', () => {
    expect(periodBefore('2026-04')).toBe('2026-03')
    expect(periodBefore('2026-01')).toBe('2025-12')
    expect(periodBefore('2026-12')).toBe('2026-11')
  })

  it('settles the month before the current one', () => {
    expect(settlementPeriodFor(new Date('2026-04-07T12:00:00Z'))).toBe('2026-03')
    expect(settlementPeriodFor(new Date('2026-01-01T00:00:00Z'))).toBe('2025-12')
  })

  it('rejects a malformed period instead of producing an invalid Date', () => {
    // `"2026-4"` 会让 `split('-').map(Number)` 得到一位数月份，
    // 而垃圾输入会静默变成 Invalid Date，最后在某处算成 NaN。
    expect(() => periodBefore('2026-4')).toThrow(/invalid period/)
    expect(() => periodBefore('garbage')).toThrow(/invalid period/)
    expect(() => periodBefore('2026-13')).toThrow(/invalid period/)
    expect(() => periodBefore('2026-00')).toThrow(/invalid period/)
  })
})

describe('statement calendar dates', () => {
  it('puts all three dates in the month AFTER the period', () => {
    // 这是最关键的一条：3 月的收入在 4 月出账。若返回 3 月 5 日，账单会在
    // 3 月刚过两天时生成，收入不完整，且一生成就已过了 19 日确认截止。
    expect(statementGenerateDate('2026-03').toISOString()).toBe('2026-04-05T00:00:00.000Z')
    expect(statementConfirmDeadline('2026-03').toISOString()).toBe(
      '2026-04-19T00:00:00.000Z'
    )
    expect(statementPayoutDate('2026-03').toISOString()).toBe('2026-04-20T00:00:00.000Z')
  })

  it('rolls the year over for December', () => {
    expect(statementGenerateDate('2025-12').toISOString()).toBe('2026-01-05T00:00:00.000Z')
    expect(statementPayoutDate('2025-12').toISOString()).toBe('2026-01-20T00:00:00.000Z')
  })

  it('orders generate < confirm < payout', () => {
    const period = '2026-03'
    expect(statementGenerateDate(period).getTime()).toBeLessThan(
      statementConfirmDeadline(period).getTime()
    )
    expect(statementConfirmDeadline(period).getTime()).toBeLessThan(
      statementPayoutDate(period).getTime()
    )
  })
})

describe('statementTimeline', () => {
  const period = '2026-03'

  it('reports the creator can still confirm before the deadline', () => {
    const timeline = statementTimeline(period, new Date('2026-04-07T00:00:00Z'))
    expect(timeline.canConfirm).toBe(true)
    expect(timeline.daysUntilConfirmDeadline).toBe(12)
    expect(timeline.daysUntilPayout).toBe(13)
  })

  it('closes confirmation at the deadline, not the day after', () => {
    // 截止日"含当日"：19 日 00:00 之后就不再算可确认，而不是等满一整天。
    expect(statementTimeline(period, new Date('2026-04-19T00:00:00Z')).canConfirm).toBe(
      false
    )
    expect(statementTimeline(period, new Date('2026-04-18T23:59:59Z')).canConfirm).toBe(
      true
    )
  })

  it('reports a negative countdown once the payout day has passed', () => {
    const timeline = statementTimeline(period, new Date('2026-04-25T00:00:00Z'))
    expect(timeline.daysUntilPayout).toBe(-5)
  })
})