/**
 * `GET /api/v1/rankings/monthly` — 指定月的排行（§5.1）。
 *
 * 与 `/weekly` 同一套逻辑，周期换成月；共用 `lib/api/rankings-route.ts` 里的实现，
 * 理由见那个文件。
 */
import { handleRankingsRequest } from "@/lib/api/rankings-route"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  return handleRankingsRequest(request, {
    period: "month",
    params: new URL(request.url).searchParams,
  })
}