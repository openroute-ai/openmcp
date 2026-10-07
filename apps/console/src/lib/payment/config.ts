/**
 * 微信支付（API v3 Native）凭据的装配。
 *
 * `@workspace/payment` 自己不读 `process.env`——凭据由宿主拼好注进网关构造器，
 * 这样包里的测试可以给假值，而"少了一个变量"这种错误发生在能看到报错的那一层。
 *
 * 与 `apps/web/src/server/payment/config.ts` 是同一套变量名、各自独立的一份：
 * 决策 #7 要求雷达自建收单，两个应用分属两个数据库，也没有共享一个 env 文件 的
 * 理由（web 的 `NOTIFY_URL` 指向 web 的回调路由，这里的指向本应用的）。
 */
import {
  WECHAT_TOPUP_REQUIRED_KEYS,
  type WeChatTopUpCredentials,
} from "@workspace/payment/topup"
import { SITE_ORIGIN } from "@/lib/config/site"

const env = (key: string): string | undefined => {
  const value = process.env[key]
  return value && value.trim() ? value.trim() : undefined
}

/** 缺哪几个 `WECHAT_*`。空数组表示可以构造网关。 */
export function missingWeChatKeys(): string[] {
  return WECHAT_TOPUP_REQUIRED_KEYS.filter((key) => {
    if (key === "WECHAT_NOTIFY_URL") {
      // 未显式配置时从站点 origin 推导，所以它缺的是 origin 而不是它自己。
      return !env("WECHAT_NOTIFY_URL") && !SITE_ORIGIN
    }
    return !env(key)
  })
}

/** 未配置时返回 null，由调用方决定是报 501 还是回退到模拟网关。 */
export function resolveWeChatCredentials(): WeChatTopUpCredentials | null {
  if (missingWeChatKeys().length > 0) return null
  return {
    appId: env("WECHAT_APP_ID")!,
    mchId: env("WECHAT_MCH_ID")!,
    apiV3Key: env("WECHAT_API_V3_KEY")!,
    mchCertSerial: env("WECHAT_MCH_CERT_SERIAL")!,
    privateKey: env("WECHAT_PRIVATE_KEY")!,
    platformPublicKey: env("WECHAT_PLATFORM_PUBLIC_KEY")!,
    notifyUrl: env("WECHAT_NOTIFY_URL") ?? `${SITE_ORIGIN}/api/webhook/wechat`,
  }
}
