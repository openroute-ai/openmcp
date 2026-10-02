/**
 * 「我的资产」列表的服务端搜索 / 分页入参，MCP / A2A / Skills 三类共用。
 *
 * 这三类资产的列表原本都是无 limit 全量返回 + 浏览器端 `filter()`：搜索只对
 * 已下发的子集生效，资产数量涨上去以后首屏会把全部行连同每行的指标聚合一起
 * 拉下来。统一收敛到 SQL 搜索 + 真分页。
 */
export interface MineListOptions {
  /** 模糊匹配名称 / slug / 端点 / 作者标识 */
  search?: string
  /** 资产状态（各表 status 枚举） */
  status?: string
  /** 从 1 开始 */
  page?: number
  /** 单页条数，调用方自定上限 */
  pageSize?: number
}

/** 统一分页响应形状，供前端 `PaginationBox` 直接消费。 */
export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
import { z } from 'zod'

/** tRPC 入参校验。三类资产共用一份，避免各自漂移。 */
export const mineListInput = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
})

/** Provider 还没有 author 资料时的空分页（形状必须和正常响应一致）。 */
export function emptyPage<T>(): Paginated<T> {
  return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }
}
