/**
 * 过滤器在 query string 里的写法（设计文档 §6.6）。
 *
 * 读取端点与订阅用**同一套**过滤器语义，所以解析也只有一份。列表是逗号分隔、布尔
 * 只接受 `true` / `false` 两个字面量：多一种写法就多一条「看起来是 true、其实走了
 * 缺省推导」的路径，而 `includeUncurated` 的缺省恰恰是按条件算出来的（§6.6 陷阱一），
 * 多一种写法就会有人踩到它。
 */
import { z } from "zod"
import { PROJECT_TYPES } from "@/db/schema"
import { resolveIncludeUncurated, type RepoFilters } from "@/lib/api/repo-filter"

const flag = z
  .union([z.literal("true"), z.literal("false")])
  .transform((value) => value === "true")

const projectTypeList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.enum(PROJECT_TYPES)))
  .optional()

const repoIdList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string().min(1)))
  .optional()

const stringList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )
  .pipe(z.array(z.string().min(1)))
  .optional()

const schema = z.object({
  repoIds: repoIdList,
  projectTypes: projectTypeList,
  categoryCodes: stringList,
  includePlatformProjects: flag.optional(),
  includeUncurated: flag.optional(),
  includeOwnSubmissions: flag.optional(),
})

/** 与 `schema` 的键同一个清单，未列出的 query 参数一律忽略。 */
const KEYS = [
  "repoIds",
  "projectTypes",
  "categoryCodes",
  "includePlatformProjects",
  "includeUncurated",
  "includeOwnSubmissions",
] as const

export type FilterQueryResult =
  | { ok: true; filters: RepoFilters }
  | { ok: false; detail: string }

/**
 * 把 query 变成过滤器。
 *
 * 枚举值写错（`projectTypes=client,tool`）报 400 而不是被静默丢掉：`tool` 不是
 * `PROJECT_TYPES` 的成员，而丢掉它会让一个「按形态订阅」的请求看起来生效了、实际
 * 少了一半的匹配。
 */
export function parseFilterQuery(params: URLSearchParams): FilterQueryResult {
  const raw: Record<string, string> = {}
  for (const key of KEYS) {
    const value = params.get(key)
    if (value !== null) raw[key] = value
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      detail: issue
        ? `${issue.path.join(".") || "(query)"}: ${issue.message}`
        : "查询参数不合法",
    }
  }

  return { ok: true, filters: parsed.data }
}

/**
 * 把过滤器补成投递时用的形状。
 *
 * `includeUncurated` 在这里落定：列表端点要原样回报调用方给了什么，订阅投递要的是
 * 求值后的布尔值。混在一起会出现「响应里写着 includeUncurated: undefined，投递时
 * 却按 true 处理」这种没法解释的行为。
 */
export function resolveFilters(filters: RepoFilters): RepoFilters & {
  includeUncurated: boolean
} {
  return { ...filters, includeUncurated: resolveIncludeUncurated(filters) }
}