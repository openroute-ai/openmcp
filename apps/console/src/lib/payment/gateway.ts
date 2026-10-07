/**
 * 收单网关的解析。
 *
 * 两条路径，一个接口：
 *
 * - `PAYMENT_SIMULATE=true`（且非 production）→ `SimulatedTopUpGateway`。它不碰
 *   任何支付网络，但回调走同一套验签与结算，所以本地能跑完"建单 → 回调 → 开通"
 *   整条链路，而不只是看到一个假的成功页。
 * - 否则 → 用 env 凭据构造 `WeChatTopUpGateway`。凭据缺失就抛，让建单接口报
 *   「支付未配置」，而不是悄悄接受一笔永远不会到账的钱。
 *
 * 生产构建拿不到模拟网关：`SimulatedTopUpGateway` 构造时就会抛，而下面的
 * `isSimulationMode` 先按 `NODE_ENV` 挡了一层，所以错误信息是关于配置的，不是
 * 关于"模拟器不许在生产跑"的。
 */
import {
  SimulatedTopUpGateway,
  WeChatTopUpGateway,
  isPaymentSimulationEnabled,
  type TopUpGateway,
} from "@workspace/payment/topup"
import { missingWeChatKeys, resolveWeChatCredentials } from "./config"

let cached: TopUpGateway | undefined

/** 开发期的模拟网关：真的会走 `verifyCallback`，只是签名来自本地常量。 */
export function isSimulationMode(): boolean {
  return isPaymentSimulationEnabled()
}

/** 生产网关的凭据是否齐了。建单前的前置检查，也是回调路由的前置检查。 */
export function isGatewayConfigured(): boolean {
  return isSimulationMode() || missingWeChatKeys().length === 0
}

/**
 * 当前网关，进程内单例。
 *
 * 缓存而不每次新建：网关只是一把凭据的封装，没有连接要复用，但每次建单都重新
 * 校验一遍 env 会让"部署后改了 env"这种事在同一个进程里表现得时好时坏。
 */
export function getGateway(): TopUpGateway {
  if (cached) return cached
  const gateway = isSimulationMode()
    ? new SimulatedTopUpGateway("wechat")
    : createProductionGateway()
  cached = gateway
  return gateway
}

/**
 * 带 `issueCallback` 的模拟网关，只有模拟路由用。
 *
 * `issueCallback` 刻意不在 `TopUpGateway` 接口上——生产代码拿不到铸造签名回调的
 * 方法。通过这里取，那条保证仍然成立。
 */
export function getSimulatedGateway(): SimulatedTopUpGateway {
  const gateway = getGateway()
  if (!(gateway instanceof SimulatedTopUpGateway)) {
    throw new Error("[payment] issueCallback 只在模拟网关上有")
  }
  return gateway
}

function createProductionGateway(): TopUpGateway {
  const credentials = resolveWeChatCredentials()
  if (!credentials) {
    const missing = missingWeChatKeys()
    throw new Error(
      `[payment] 微信支付网关未配置（缺少：${missing.join(", ")}）。` +
        "设置 WECHAT_* 凭据，或在开发环境使用 PAYMENT_SIMULATE=true。"
    )
  }
  return new WeChatTopUpGateway(credentials)
}
