import { format } from 'date-fns'

/**
 * Format a price for display
 * @param price Price amount in currency units (dollars, euros, etc.)
 * @param currency Currency code
 * @returns Formatted price string
 */
export function formatPrice(price: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  })

  return formatter.format(price / 100) // Convert from cents to dollars
}

/**
 * Format a date for display
 * @param date Date to format
 * @returns Formatted date string in the format "Month Day, Year"
 */
export function formatDate(date: Date | string | undefined | null): string {
  if (!date) return '-'
  if (typeof date === 'string') {
    date = new Date(date)
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 *  格式化为 yyyy-MM-dd HH:mi:ss
 * @param date
 * @returns
 */
export function formatDateTime(date: Date | string | undefined | null): string {
  if (!date) return '-'
  if (typeof date === 'string') {
    date = new Date(date)
  }
  return format(date, 'yyyy-MM-dd HH:mm:ss')
}

/**
 * 处理科学计数法，转换为正常数字
 * @param value 可能是科学计数法的字符串或数字
 * @returns 数字
 */
export const parseScientificNotation = (value: number | string | undefined | null): number => {
  if (value === undefined || value === null) return 0
  if (typeof value === 'string') {
    return Number.parseFloat(value)
  }
  return value
}

/**
 * 将日期字符串（YYYYMMDD）转换为日期对象
 * @param dateStr 日期字符串，支持 YYYYMMDD 或 ISO 格式
 * @returns Date 对象
 */
export const parseDate = (dateStr: string): Date => {
  // 处理 YYYYMMDD 格式
  if (dateStr.length === 8 && /^\d+$/.test(dateStr)) {
    const year = Number.parseInt(dateStr.slice(0, 4), 10)
    const month = Number.parseInt(dateStr.slice(4, 6), 10) - 1 // 月份从0开始
    const day = Number.parseInt(dateStr.slice(6, 8), 10)
    return new Date(year, month, day)
  }
  // 如果是 ISO 格式或其他格式，直接解析
  return new Date(dateStr)
}

/**
 * 格式化日期为 YYYY-MM-DD 格式，用于图表显示
 * @param dateStr 日期字符串
 * @returns YYYY-MM-DD 格式的日期字符串
 */
export const formatDateForChart = (dateStr: string): string => {
  const date = parseDate(dateStr)
  return date.toISOString().split('T')[0] ?? dateStr
}

// Format currency values
export const formatCurrency = (
  value: number | string | undefined | null,
  currency = 'CNY',
  options?: {
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  }
) => {
  // 处理科学计数法（字符串或数字形式）
  const numValue = parseScientificNotation(value)

  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: options?.minimumFractionDigits ?? 2,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    notation: 'standard',
  }).format(numValue)
}

/**
 * 格式化数字
 * @param number 数字
 * @param options 格式化选项
 * @returns 格式化后的数字字符串
 */
export const formatNumber = (
  number: number | undefined | null,
  options?: {
    useLocale?: boolean
    decimals?: number
  }
) => {
  if (number === undefined || number === null) {
    return '0'
  }
  if (number >= 1000000000) {
    return `${(number / 1000000000).toFixed(options?.decimals ?? 1)}B`
  }
  if (number >= 1000000) {
    return `${(number / 1000000).toFixed(options?.decimals ?? 1)}M`
  }
  if (number >= 1000) {
    return `${(number / 1000).toFixed(options?.decimals ?? 1)}K`
  }
  if (options?.useLocale) {
    return number.toLocaleString('zh-CN')
  }
  return number.toString()
}

export const formatPercentage = (percentage: number | undefined | null) => {
  if (percentage === undefined || percentage === null) {
    return '0%'
  }
  // 使用 toFixed(2) 保留最多2位小数，然后移除不必要的尾随零
  const formatted = percentage.toFixed(2).replace(/\.?0+$/, '')
  return `${formatted}%`
}

export const formatContextLength = (contextLength: number | undefined | null) => {
  if (contextLength === undefined || contextLength === null) {
    return 'N/A'
  }
  if (contextLength >= 1000000000) {
    return `${(contextLength / 1000000000).toFixed(0)}B`
  }
  if (contextLength >= 1000000) {
    return `${(contextLength / 1000000).toFixed(0)}M`
  }
  if (contextLength >= 1000) {
    return `${(contextLength / 1000).toFixed(0)}K`
  }
  return contextLength.toString()
}

// 格式化金额
export const formatAmount = (amount?: number) => {
  return `¥${amount ? Number(amount)?.toFixed(2) : '0.00'}`
}

/**
 * 首字母大写
 * @param str 字符串
 * @returns 首字母大写后的字符串
 */
export const capitalizeFirst = (str: string) => {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
