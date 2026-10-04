/**
 * 写入端点的一次性回调。
 *
 * 登记与发布都是「请求返回时数据已经在库里了」的动作，回调解决的是另一件事：
 * 调用方拿到的响应里只有 id 与状态，它接下来要自己去读统计、读榜单、读项目文档，
 * 而那些数据要等下一个周期任务才有。回调把「可以开始读了」这件事告诉它。
 *
 * 三条设计：
 *
 * 1. **复用 `lib/webhook/client.ts` 的签名**，不另造一套 `X-Webhook-Signature`。
 * 2. **同步等待、有超时**。它只多花一次请求的时间，换来的是「响应返回时回调已经
 *    送达或已经失败」——异步 fire-and-forget 会让回调地址写错这件事永远不被发现。
 * 3. **失败不影响本次调用的结果**。数据已经落库了，把一次写成功报成失败，调用方
 *    的重试只会登记两次；所以回调的结果只进日志。
 */
import { sendWebhook } from "@/lib/webhook/client"

/** 回调体的形状。`eventId` 是幂等键：同一个写请求的回调重发时它不变。 */
export interface WriteCallbackPayload {
  eventId: string
  event: "repo.registered" | "repo.published"
  occurredAt: string
  fullName: string
  repoId: string
  created: boolean
  /** 发布才有：project id。登记没有 project，所以这个字段不出现。 */
  projectId?: string
}

export interface CallbackOutcome {
  delivered: boolean
  status?: number
  error?: string
}

/**
 * 发一次回调，永不抛错。
 *
 * `eventId` 由事件名加仓库 id 派生，而不是随机：同一个写请求因为超时被重发时，
 * 接收方按 `eventId` 去重就能认出这是同一件事，而不是两次独立的登记。
 */
export async function deliverWriteCallback(
  callback: { url: string; secret: string },
  payload: Omit<WriteCallbackPayload, "eventId" | "occurredAt">
): Promise<CallbackOutcome> {
  const body: WriteCallbackPayload = {
    ...payload,
    eventId: `${payload.event}.${payload.repoId}`,
    occurredAt: new Date().toISOString(),
  }

  try {
    const [result] = await sendWebhook([callback.url], body, {
      secret: callback.secret,
    })
    if (!result) return { delivered: false, error: "no result" }
    return result.success
      ? { delivered: true, status: result.status }
      : { delivered: false, status: result.status, error: result.error }
  } catch (error) {
    return {
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}