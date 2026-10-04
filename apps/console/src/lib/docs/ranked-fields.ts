/**
 * 榜单条目的字段说明。
 *
 * 这份表原本住在 `lib/docs/public-api.ts`——那份文件描述的是四个免鉴权的 `*.json`
 * 端点，端点删掉之后表本身没跟着作废：`GET /api/v1/rankings/weekly` 与 `/monthly`
 * 返回的 `trending[]`、`byRelativeGrowth[]` 里仍然是同一种记录，也就是 `RankedProject`。
 *
 * 单独成文件而不是并回 schema 的理由：字段的**含义**（为什么 `relativeGrowth` 在期初
 * 为 0 时是 `null` 而不是 `Infinity`）在 JSON Schema 里写不下，而这份表要同时喂
 * `llms-full.txt` 与文档正文。字段本身仍由 `RankedProject` 定义，两边不一致时以
 * schema 为准。
 */

/** 与 `RankedProject` 对应的一行榜单记录。 */
export interface RankedFieldDoc {
  path: string
  type: string
  detail: string
}

export const RANKED_PROJECT_FIELDS: RankedFieldDoc[] = [
  {
    path: "fullName",
    type: "string",
    detail:
      "`owner/name`，榜单的自然键，也是 `byRelativeGrowth` 里的同一个键。",
  },
  { path: "name", type: "string", detail: "仓库名，不含 owner。" },
  { path: "description", type: "string", detail: "项目描述。" },
  { path: "stars", type: "number", detail: "周期结束时点的累计星标。" },
  {
    path: "delta",
    type: "number",
    detail: "该周期获得的星标数，可为负。榜单默认按它降序。",
  },
  {
    path: "relativeGrowth",
    type: "number | null",
    detail: "增量除以期初星标。期初为 0 时是 `null`，不是 `Infinity`。",
  },
  {
    path: "tags",
    type: "string[]",
    detail: "从仓库 topics 归一化来的分类 code。",
  },
  {
    path: "ownerId",
    type: "number",
    detail: "GitHub owner 的数字 id，可用于头像 URL。",
  },
  { path: "createdAt", type: "string", detail: "仓库创建时间，ISO 8601。" },
  {
    path: "logo / iconUrl / avatar",
    type: "string | null",
    detail:
      "渲染列表需要的标记，按这个优先级取。三个都是 `null` 是正常的，回退到项目首字母。",
  },
  {
    path: "anomaly",
    type: "object | null",
    detail:
      "该仓库当期最严重的一条未处理异动，带 `kind` / `severity` / `title`。没有则为 `null`。",
  },
]