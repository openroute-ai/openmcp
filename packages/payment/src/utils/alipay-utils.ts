import crypto from 'crypto'

/**
 * 支付宝工具函数
 * 提供签名验证、数据处理等生产级别的功能
 */

/**
 * 验证支付宝回调签名
 * @param params 回调参数
 * @param signature 签名
 * @param publicKey 支付宝公钥
 * @returns 是否验证通过
 */
export function verifySignature(params: Record<string, any>, signature: string, publicKey: string): boolean {
  try {
    // 1. 过滤空值并排序
    const filteredParams = Object.keys(params)
      .filter(
        (key) =>
          params[key] !== null &&
          params[key] !== undefined &&
          params[key] !== '' &&
          key !== 'sign' &&
          key !== 'sign_type'
      )
      .sort()
      .reduce(
        (result, key) => {
          result[key] = params[key]
          return result
        },
        {} as Record<string, any>
      )

    // 2. 构建签名字符串
    const signString = Object.keys(filteredParams)
      .map((key) => `${key}=${filteredParams[key]}`)
      .join('&')

    // 3. 使用RSA公钥验证签名
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(signString, 'utf8')

    return verify.verify(publicKey, signature, 'base64')
  } catch (error) {
    console.error('Alipay signature verification error:', error)
    return false
  }
}

/**
 * 生成支付宝签名
 * @param params 参数对象
 * @param privateKey 私钥
 * @returns 签名字符串
 */
export function generateSignature(params: Record<string, any>, privateKey: string): string {
  try {
    // 1. 过滤空值并排序
    const filteredParams = Object.keys(params)
      .filter((key) => params[key] !== null && params[key] !== undefined && params[key] !== '')
      .sort()
      .reduce(
        (result, key) => {
          result[key] = params[key]
          return result
        },
        {} as Record<string, any>
      )

    // 2. 构建签名字符串
    const signString = Object.keys(filteredParams)
      .map((key) => `${key}=${filteredParams[key]}`)
      .join('&')

    // 3. 使用RSA私钥签名
    const sign = crypto.createSign('RSA-SHA256')
    sign.update(signString, 'utf8')

    return sign.sign(privateKey, 'base64')
  } catch (error) {
    console.error('Alipay signature generation error:', error)
    throw new Error('Failed to generate signature')
  }
}

/**
 * 验证支付宝回调的必要字段
 * @param data 回调数据
 * @returns 验证结果
 */
export function validateWebhookData(data: Record<string, any>): {
  valid: boolean
  error?: string
} {
  const requiredFields = ['trade_status', 'out_trade_no', 'trade_no']

  for (const field of requiredFields) {
    if (!data[field]) {
      return { valid: false, error: `缺少必要字段: ${field}` }
    }
  }

  // 验证交易状态
  const validStatuses = ['TRADE_SUCCESS', 'TRADE_FINISHED', 'TRADE_CLOSED']
  if (!validStatuses.includes(data.trade_status)) {
    return { valid: false, error: `无效的交易状态: ${data.trade_status}` }
  }

  return { valid: true }
}

/**
 * 判断是否为充值订单
 * @param outTradeNo 商户订单号
 * @returns 是否为充值订单
 */
export function isRechargeOrder(outTradeNo: string): boolean {
  return outTradeNo.startsWith('recharge_')
}

/**
 * 判断是否为订阅订单
 * @param outTradeNo 商户订单号
 * @returns 是否为订阅订单
 */
export function isSubscriptionOrder(outTradeNo: string): boolean {
  return outTradeNo.startsWith('alipay_') && !outTradeNo.startsWith('recharge_')
}

/**
 * 安全地解析JSON字符串
 * @param jsonString JSON字符串
 * @param defaultValue 默认值
 * @returns 解析结果
 */
export function safeParseJSON<T = any>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString)
  } catch {
    return defaultValue
  }
}

/**
 * 将对象转换为查询字符串
 * @param obj 对象
 * @returns 查询字符串
 */
export function objectToQueryString(obj: Record<string, any>): string {
  return Object.keys(obj)
    .filter((key) => obj[key] !== null && obj[key] !== undefined && obj[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`)
    .join('&')
}

/**
 * 将查询字符串转换为对象
 * @param queryString 查询字符串
 * @returns 对象
 */
export function queryStringToObject(queryString: string): Record<string, any> {
  const params = new URLSearchParams(queryString)
  const result: Record<string, any> = {}

  for (const [key, value] of params.entries()) {
    result[key] = value
  }

  return result
}

/**
 * 生成随机字符串
 * @param length 长度
 * @returns 随机字符串
 */
export function generateNonceStr(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * 格式化金额（元转分）
 * @param amount 金额（元）
 * @returns 金额（分）
 */
export function formatAmount(amount: number): string {
  return (amount * 100).toFixed(0)
}

/**
 * 解析金额（分转元）
 * @param amount 金额（分）
 * @returns 金额（元）
 */
export function parseAmount(amount: string): number {
  return Number.parseFloat(amount) / 100
}
