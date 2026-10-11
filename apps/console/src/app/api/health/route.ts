/**
 * 存活探针：这个实例能不能正常应答。
 *
 * 与 `apps/api` 的 `/api/v1/health` 和 `apps/vercel-egress` 的 `/healthz` 保持
 * 同一形态——公开、不带任何凭据。探针本来就没有密钥，而「进程还活着」这件事本身
 * 不泄露任何东西。
 *
 * 刻意不碰依赖：数据库抖一下不该让编排器把容器重启掉，所以这里连 `db` 都不 import，
 * 就绪检查是另一个端点的事。`src/proxy.ts` 的 matcher 把 `api` 整段排除在认证与
 * 语言协商之外，所以这个路径不需要任何豁免就能被探针直接打到。
 */
import { NextResponse } from "next/server"

/**
 * 不做构建期预渲染：探针要报告的是「此刻被打到的这个实例」，一份构建时烤死的
 * 常量 JSON 回答不了这个问题，而 `output: "standalone"` 的容器里它甚至可能
 * 根本不随请求执行。
 */
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ status: "ok" })
}
