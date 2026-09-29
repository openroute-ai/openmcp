/**
 * 图表调色板：全局彩色系（拒绝灰/黑等低区分度色调）
 * 用于各图表在不同数据系列间提供高对比、高饱和的色彩差异。
 */
export const CHART_COLORS = [
  'oklch(0.60 0.25 265)', // 靛蓝
  'oklch(0.70 0.25 25)', // 亮橙
  'oklch(0.65 0.22 195)', // 亮青
  'oklch(0.68 0.28 85)', // 亮绿
  'oklch(0.68 0.30 300)', // 亮紫
  'oklch(0.72 0.25 45)', // 亮黄
  'oklch(0.65 0.23 245)', // 亮蓝
  'oklch(0.66 0.28 165)', // 青绿
  'oklch(0.70 0.28 350)', // 粉红
  'oklch(0.68 0.25 210)', // 蓝绿
  'oklch(0.66 0.26 330)', // 紫红
  'oklch(0.60 0.25 290)', // 蓝紫
  'oklch(0.70 0.26 15)', // 红橙
] as const

/** 根据索引取色，超出时循环取用 */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0]!
}
