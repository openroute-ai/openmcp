import { type NextRequest, NextResponse } from "next/server"
import { settleSubscriptionOrder } from "@/lib/billing/settle"
import {
  getGateway,
  getSimulatedGateway,
  isGatewayConfigured,
  isSimulationMode,
} from "@/lib/payment/gateway"

/**
 * 微信支付回调（支付结果通知）— API v3 Native。
 *
 * 生产：`WeChatTopUpGateway.verifyCallback` 验 `Wechatpay-Signature` 并用 APIv3 密钥
 * 解密报文，然后进 `settleSubscriptionOrder`（金额核对 + 幂等开通）。
 *
 * 开发：`PAYMENT_SIMULATE=true` 时模拟网关自己验签——同一套流程，只是签名来自本地
 * 常量。真正的入口仍是 `POST /api/pay/simulate/[orderId]`，这条路径是为了让"如果
 * 微信真的打过来会怎样"这个问题也有代码可跑。
 *
 * ACK 语义与微信 v3 的约定一致：**签名失败回 FAIL**（微信会重试，我们也希望它重试，
 * 因为可能是我们解析错了），**签名有效但业务被拒回 SUCCESS**（金额不符、订单过期）
 * ——否则微信会以固定间隔重试到天荒地老，而重试多少次都不会改变结果。
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const ackSuccess = () =>
  NextResponse.json({ code: "SUCCESS", message: "成功" }, { status: 200 })

const ackFailure = (message: string, status = 400) =>
  NextResponse.json({ code: "FAIL", message }, { status })

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody.trim()) {
    return ackFailure("empty body", 400)
  }

  try {
    if (isSimulationMode()) {
      return handleSimulated(rawBody, request)
    }

    if (!isGatewayConfigured()) {
      console.warn(
        "[wechat-webhook] production credentials not configured; refusing to settle"
      )
      return ackFailure("gateway not configured", 501)
    }

    const signature =
      request.headers.get("Wechatpay-Signature") ??
      request.headers.get("wechatpay-signature") ??
      ""

    const verified = await getGateway().verifyCallback(
      rawBody,
      signature,
      request.headers
    )
    if (!verified.ok) {
      // 非 SUCCESS 的交易状态不是伪造——ACK 让微信别再重试。
      if (verified.error.includes("trade_state")) {
        console.info("[wechat-webhook] ignoring non-success trade", verified.error)
        return ackSuccess()
      }
      console.error("[wechat-webhook] verification failed", verified.error)
      return ackFailure(verified.error, 401)
    }

    return settle(verified.callback)
  } catch (error) {
    console.error("[wechat-webhook] unexpected error", error)
    return ackFailure("internal error", 500)
  }
}

/**
 * 统一的结算出口：两个分支（真实回调 / 模拟回调）拿到的都是归一化后的
 * `TopUpCallback`，所以业务判断只写一遍。
 */
async function settle(callback: {
  orderId: string
  amount: string
  transactionId?: string
  raw?: Record<string, unknown>
}) {
  const result = await settleSubscriptionOrder({
    orderId: callback.orderId,
    reason: isSimulationMode() ? "dev_simulated" : "wechat_webhook",
    reportedAmount: callback.amount,
    transactionId: callback.transactionId,
    webhookData: { raw: callback.raw },
  })

  if (!result.ok) {
    // 签名合法、业务拒绝：停止重试，但把原因打到日志里——金额不符是要人看的。
    console.error(
      "[wechat-webhook] settlement rejected",
      result.code,
      result.error,
      callback.orderId
    )
    return ackSuccess()
  }

  return ackSuccess()
}

async function handleSimulated(rawBody: string, request: NextRequest) {
  const gateway = getSimulatedGateway()
  const signature =
    request.headers.get("X-Simulation-Signature") ??
    request.headers.get("Wechatpay-Signature") ??
    ""

  // 模拟器发的是纯 JSON 的 TopUpCallback；也接受 `{payload, signature}` 的包裹。
  let payload = rawBody
  let sig = signature
  try {
    const parsed = JSON.parse(rawBody) as { payload?: string; signature?: string }
    if (parsed.payload && parsed.signature) {
      payload = parsed.payload
      sig = parsed.signature
    }
  } catch {
    // 原文本身就是被签名的内容。
  }

  const verified = await gateway.verifyCallback(payload, sig)
  if (!verified.ok) {
    console.error("[wechat-webhook] simulated verification failed", verified.error)
    return ackFailure(verified.error, 400)
  }

  return settle(verified.callback)
}
