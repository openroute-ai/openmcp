/**
 * `GET /api/v1/rankings/weekly` — 指定周的排行（§5.1）。
 *
 * 逻辑与 `/monthly` 完全一致，只有周期不同，所以实现在 `lib/api/rankings-route.ts`
 * 里共用一份：这个端点与 `/monthly` 各写一遍的差别不是 DRY，而是**修一处漏一处**——
 * `period` 回显、`ETag`、缺省参数落在「最近一个完整周期」上，任何一条漏在另一个文件
 * 里，两个周期就会给出不同的答案。
 */
import { handleRankingsRequest } from "@/lib/api/rankings-route"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return handleRankingsRequest(request, {
    period: "week",
    params: new URL(request.url).searchParams,
  })
}