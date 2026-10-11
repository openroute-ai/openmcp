/**
 * 存活探针：这个实例能不能正常应答。
 *
 * 与 `apps/api` 的 `/api/v1/health`、`apps/vercel-egress` 的 `/healthz` 同一形态
 * ——公开、不带凭据。探针本来就没有密钥，而「进程还活着」不泄露任何东西。
 *
 * 刻意不碰依赖：文档站的内容是构建期编译进来的，运行时没有数据库可查，探针也
 * 不该为了「看起来更有内容」去拉外部模型。`src/proxy.ts` 的 matcher 只覆盖
 * `/docs`、`/llms*.txt` 等内容路径，`/api/*` 根本不在其中，探针可直达。
 */
import { NextResponse } from "next/server"

/**
 * 不做构建期预渲染：探针要报告的是「此刻被打到的这个实例」，一份构建时烤死的
 * 常量 JSON 回答不了这个问题。
 */
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ status: "ok" })
}
