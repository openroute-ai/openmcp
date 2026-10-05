/**
 * 列表端点的游标。
 *
 * 与 `lib/api/stats.ts` 的那一套**刻意平行但不共用**：统计游标编码的是一个瞬间
 * （`period`），列表游标编码的是一个 id，形状不同；更重要的是它们要在各自的模块里
 * 各自说清"为什么坏游标必须报 400"。合成一个通用的游标类型只会得到一个把两种语义
 * 都表达得含糊的 `string`。
 *
 * base64 只是让它看起来不透明。真正防误用的是**校验**：一个被当成"没有游标"的坏游标会
 * 静默退回第一页，调用方会以为数据只有一页。
 */
import { z } from "zod"

/** 一次翻多少行。默认与上限见 {@link repoListPageSchema}。 */
export const REPO_LIST_DEFAULT_LIMIT = 50
export const REPO_LIST_MAX_LIMIT = 500

export const repoListPageSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REPO_LIST_MAX_LIMIT)
    .default(REPO_LIST_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
})

export type RepoListPage = z.output<typeof repoListPageSchema>

export function parseRepoListPage(params: URLSearchParams) {
  const parsed = repoListPageSchema.safeParse(Object.fromEntries(params))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false as const,
      detail: issue
        ? `${issue.path.join(".") || "(query)"}: ${issue.message}`
        : "查询参数不合法",
    }
  }
  return { ok: true as const, value: parsed.data }
}

/** 编码"下一页从这一行之后开始"。 */
export function encodeRepoCursor(repoId: string): string {
  return Buffer.from(repoId, "utf8").toString("base64url")
}

/**
 * 坏游标返回 null，由调用方报 400。
 *
 * 顺带解出**非空**且不含 `;` 的 id：`;` 是 URL 路径分隔符，一个含它的游标只可能来自
 * 构造出来的输入，而它恰好也是 `text` 主键被拼接查询的注入位。挡住它比在下游
 * 每处参数化查询上重复依赖要便宜。
 */
export function decodeRepoCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8")
    if (decoded.length === 0) return null
    // 仓库 id 是 base64url 的 16 字节，与之相符；宽松一点只排除明显的畸形。
    if (/[^A-Za-z0-9_-]/.test(decoded)) return null
    return decoded
  } catch {
    return null
  }
}