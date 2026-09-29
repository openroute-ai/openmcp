import crypto from 'crypto'
import { parseString } from 'xml2js'

/**
 * 解析微信支付XML响应
 * @param xml XML字符串
 * @returns 解析后的对象
 */
export async function parseXML(xml: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false }, (err, result) => {
      if (err) {
        reject(new Error(`XML解析失败: ${err.message}`))
        return
      }

      // 微信支付返回的XML结构通常是 { xml: { ... } }
      const data = result.xml || result
      resolve(data)
    })
  })
}

/**
 * 生成微信支付签名
 * @param params 参数对象
 * @param apiKey API密钥
 * @returns 签名字符串
 */
export function generateSignature(params: Record<string, any>, apiKey: string): string {
  // 1. 过滤空值、排除sign字段并排序
  const filteredParams = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== null && params[key] !== undefined && params[key] !== '')
    .sort()
    .reduce(
      (result, key) => {
        result[key] = params[key]
        return result
      },
      {} as Record<string, any>
    )

  // 2. 构建签名字符串
  const signString = `${Object.keys(filteredParams)
    .map((key) => `${key}=${filteredParams[key]}`)
    .join('&')}&key=${apiKey}`

  // 3. MD5加密并转大写
  return crypto.createHash('md5').update(signString, 'utf8').digest('hex').toUpperCase()
}

/**
 * 验证微信支付签名
 * @param params 参数对象（包含sign字段）
 * @param signature 待验证的签名（如果未提供，则从params中提取）
 * @param apiKey API密钥
 * @returns 是否验证通过
 */
export function verifySignature(params: Record<string, any>, signature: string, apiKey: string): boolean {
  // 如果signature未提供，尝试从params中提取
  const signToVerify = signature || params.sign

  if (!signToVerify) {
    console.error('[WeChat Signature] No signature provided for verification')
    return false
  }

  // generateSignature会自动排除sign字段，所以直接传入完整params即可
  const calculatedSignature = generateSignature(params, apiKey)
  const isValid = calculatedSignature === signToVerify

  if (!isValid) {
    console.error('[WeChat Signature] Signature mismatch', {
      calculated: calculatedSignature,
      received: signToVerify,
    })
  }

  return isValid
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
 * 将对象转换为XML字符串
 * @param obj 对象
 * @returns XML字符串
 */
export function objectToXML(obj: Record<string, any>): string {
  let xml = '<xml>'
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      xml += `<${key}><![CDATA[${value}]]></${key}>`
    }
  }
  xml += '</xml>'
  return xml
}

/**
 * 验证微信支付回调的必要字段
 * @param data 回调数据
 * @returns 验证结果
 */
export function validateWebhookData(data: Record<string, any>): {
  valid: boolean
  error?: string
} {
  const requiredFields = ['return_code', 'result_code', 'out_trade_no']

  for (const field of requiredFields) {
    if (!data[field]) {
      return { valid: false, error: `缺少必要字段: ${field}` }
    }
  }

  // 验证return_code
  if (data.return_code !== 'SUCCESS') {
    return { valid: false, error: `return_code错误: ${data.return_code}` }
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
  return outTradeNo.startsWith('wechat_') && !outTradeNo.startsWith('recharge_')
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
