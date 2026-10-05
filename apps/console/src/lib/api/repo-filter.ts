/**
 * 仓库过滤器与分类四轴（设计文档 §1.5 / §6.6）。
 *
 * 一处求值，两处使用：`GET /api/v1/repos` 列出命中项，订阅投递算出「这条数据该不该
 * 推」。写两份的后果不是慢一点，而是**两份会漂**：调用方按文档建的过滤器在列表里能
 * 用、在推送里却收不到数据，而这类不一致要等到第二天早上才看得出来。
 *
 * 求值顺序是「先命中即短路」，语义上等价于 OR，所以实现成一个 OR：
 *
 * 1. `repoIds` 非空 → 完全绕过下面所有规则；
 * 2. 自己的提交 且 `includeOwnSubmissions`；
 * 3. 是平台项目 且 `includePlatformProjects` 且（`platformTypes` 为空或命中）；
 * 4. 有 project 行 且 `categoryCodes` 命中；
 * 5. 有 project 行 且 `projectTypes` 命中；
 * 6. 无 project 行 且 `includeUncurated`；
 * 7. 其他 → 不命中。
 *
 * 两个刻意的取舍，都写在代码里而不是注释里：
 *
 * - **`repoIds` 只绕过过滤器，不绕过可见性。** 它是「显式白名单」，不是「越权凭证」：
 *   一个没有任何 project 行、也不是这把 key 提交过的仓库，对谁都是不可见的，把它的
 *   id 写进参数不该让它出现在响应里。
 * - **规则 3 加 `status <> 'hidden'`，规则 4 / 5 不加。** 「是不是平台项目」问的是
 *   公开页能不能看见（§1.5），而「有没有 project 行」问的是策展过没有。给 4 / 5 也
 *   加上 hidden 过滤，会让一个被撤下的项目从分类过滤里消失，而它的仓库仍然是策展过
 *   的——`categoryCode IS NOT NULL` 之类的二次筛选会把这类仓库整个漏掉。
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import {
  categories,
  projects,
  projectsToTags,
  repos,
  tags,
  userRepos,
  type ProjectType,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import { type subscriptionFiltersSchema } from "@/lib/api/contract"
import type { z } from "zod"

/** 过滤器求值的输入，与 `subscriptionFiltersSchema` 的输出同形。 */
export type RepoFilters = z.output<typeof subscriptionFiltersSchema>

/** 契约里的 `platformStatus`，比库里的枚举多一个 `pending`。 */
export type PlatformStatus = "pending" | "tracked" | "curated" | "archived"

/** §1.5 的分类四轴。 */
export interface RepoClassification {
  projectTypes: ProjectType[]
  categoryCode: string | null
  categoryReviewed: boolean
  isPlatformProject: boolean
  platformStatus: PlatformStatus
  tags: string[]
}

/**
 * `includeUncurated` 的缺省按条件推导（§6.6 陷阱一）。
 *
 * 固定成 `false` 的话，「按形态订阅」会静默地拿不到任何未策展仓库 —— 而按形态过滤
 * 正是最常见的写法，等于这个开关在绝大多数订阅里等于不存在。反过来，形态/分类全空时
 * 缺省 `true` 又符合直觉：不带过滤器的订阅应该看到雷达跟踪的全部仓库。
 */
export function resolveIncludeUncurated(filters: RepoFilters): boolean {
  if (typeof filters.includeUncurated === "boolean") {
    return filters.includeUncurated
  }
  const narrowed =
    (filters.projectTypes?.length ?? 0) > 0 ||
    (filters.categoryCodes?.length ?? 0) > 0 ||
    (filters.platformTypes?.length ?? 0) > 0
  return !narrowed
}

/**
 * 可见性：公开可见，或这把 key 自己提交过的。
 *
 * 「公开可见」= 至少一个 `status <> 'hidden'` 的 project 行（`public/radar.ts` 的
 * `PUBLIC_WHERE` 同一条）。不是「被跟踪过」：`repos` 行里那些还没有 project 的仓库
 * 是雷达的候选，不是公开内容。
 */
export function repoVisibilityCondition(ownerUserId: string | null): SQL {
  const publicRepo = sql<boolean>`exists (
    select 1 from ${projects} p
    where p.repo_id = ${repos.id} and p.status <> 'hidden'
  )`

  // service key 没有提交人，于是「自己提交的」这一支恒假，公开可见成了唯一来源。
  if (!ownerUserId) return publicRepo

  const ownSubmission = sql<boolean>`exists (
    select 1 from ${userRepos} ur
    where ur.repo_id = ${repos.id} and ur.user_id = ${ownerUserId}
  )`

  return or(publicRepo, ownSubmission)!
}

/**
 * `col in (?, ?, ?)` 的**完整** `IN` 表达式，含那对括号。
 *
 * 括号不能省：`sql.join` 只负责把元素用分隔符连起来，它不知道调用方的语法上下文，
 * 于是 `sql.join([...], sql\`,\ `)` 渲染出来的是裸的 `$1, $2`。写 `p.type in ${...}`
 * 得到的是 `p.type in $1, $2` —— Postgres 报 `syntax error at or near "$1"`，
 * 三个分类过滤器（§6.6 的形态 / 分类 / 平台形态）全部 500，而不带过滤器的列表照常
 * 200，于是这个错误只出现在"调用方真的想按类型筛"的路径上。
 *
 * 参数化而不是拼字面量：这些值来自查询参数，拼进 SQL 就是注入面。
 */
function inList(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )})`
}

/**
 * 过滤条件，或者 undefined（无过滤 = 全部可见仓库都命中）。
 *
 * `undefined` 而不是恒真的 SQL：`inArray(repos.id, [])` 在 Postgres 里是 `false`，
 * 恒真的表达式又会让优化器失去走索引的机会。这里返回 undefined 让调用方直接省略
 * `where` 里的这一段。
 */
export function repoFilterCondition(
  filters: RepoFilters,
  ownerUserId: string | null
): SQL | undefined {
  // 规则 1：白名单完全覆盖其余规则。见文件头关于可见性的说明。
  if (filters.repoIds && filters.repoIds.length > 0) {
    return inArray(repos.id, filters.repoIds)
  }

  const rules: (SQL | undefined)[] = []

  // 规则 2：自己的提交。
  if (filters.includeOwnSubmissions !== false && ownerUserId) {
    rules.push(
      sql<boolean>`exists (
        select 1 from ${userRepos} ur
        where ur.repo_id = ${repos.id} and ur.user_id = ${ownerUserId}
      )`
    )
  }

  // 规则 3：平台项目（公开可见的那种），可再按形态收窄。
  //
  // `!== false` 而不是真值判断：§6.1 里 `include_platform` 的列默认值是 `true`，
  // 而「不带任何过滤器的订阅应该看到雷达跟踪的全部仓库」。真值判断会让缺省的
  // `undefined` 把这一支整个关掉，于是未过滤的列表只剩未策展仓库——已策展的公开
  // 项目凭空消失，而调用方并没有要求过任何过滤。
  if (filters.includePlatformProjects !== false) {
    const platformTypes = filters.platformTypes ?? []
    rules.push(
      sql<boolean>`exists (
        select 1 from ${projects} p
        where p.repo_id = ${repos.id} and p.status <> 'hidden'
        ${platformTypes.length > 0 ? sql`and p.type in ${inList(platformTypes)}` : sql``}
      )`
    )
  }

  // 规则 4：有 project 行且运营分类命中。
  if (filters.categoryCodes && filters.categoryCodes.length > 0) {
    rules.push(
      sql<boolean>`exists (
        select 1 from ${projects} p
        join ${categories} c on c.id = p.category_id
        where p.repo_id = ${repos.id} and c.code in ${inList(filters.categoryCodes)}
      )`
    )
  }

  // 规则 5：有 project 行且形态命中。
  if (filters.projectTypes && filters.projectTypes.length > 0) {
    rules.push(
      sql<boolean>`exists (
        select 1 from ${projects} p
        where p.repo_id = ${repos.id} and p.type in ${inList(filters.projectTypes)}
      )`
    )
  }

  // 规则 6：完全没有 project 行。缺省按条件推导，不是固定 false。
  if (resolveIncludeUncurated(filters)) {
    rules.push(
      sql<boolean>`not exists (select 1 from ${projects} p where p.repo_id = ${repos.id})`
    )
  }

  const combined = or(...rules.filter((rule): rule is SQL => rule !== undefined))
  return combined ?? undefined
}

/** 可见 + 过滤。 */
export function repoScopeCondition(
  filters: RepoFilters,
  ownerUserId: string | null
): SQL | undefined {
  const visibility = repoVisibilityCondition(ownerUserId)
  const filter = repoFilterCondition(filters, ownerUserId)
  return filter ? and(visibility, filter) : visibility
}

/** 命中的仓库行 + 那些能从同一行里读出来的轴。 */
export interface RepoFilterRow {
  id: string
  archived: boolean
  projectCount: number
  isPlatformProject: boolean
}

const FILTER_COLUMNS = {
  id: repos.id,
  archived: sql<boolean>`coalesce(${repos.archived}, false)`,
  projectCount: sql<number>`(select count(*)::int from ${projects} p where p.repo_id = ${repos.id})`,
  isPlatformProject: sql<boolean>`exists (
    select 1 from ${projects} p where p.repo_id = ${repos.id} and p.status <> 'hidden'
  )`,
}

/** 满足过滤条件的仓库 id，升序。投递任务与 `matchedRepos` 用它。 */
export async function listFilteredRepoIds(
  db: Db,
  filters: RepoFilters,
  ownerUserId: string | null
): Promise<string[]> {
  const rows = await db
    .select({ id: repos.id })
    .from(repos)
    .where(repoScopeCondition(filters, ownerUserId))
    .orderBy(repos.id)

  return rows.map((row) => row.id)
}

/** 同上，连带把能从一行里读出来的轴一起读出来。 */
export async function listFilteredRepos(
  db: Db,
  filters: RepoFilters,
  ownerUserId: string | null
): Promise<RepoFilterRow[]> {
  return db
    .select(FILTER_COLUMNS)
    .from(repos)
    .where(repoScopeCondition(filters, ownerUserId))
    .orderBy(repos.id)
}

/** 分类四轴，按仓库 id 归并。 */
export type ClassificationMap = Map<string, RepoClassification>

/**
 * 把四轴补齐。
 *
 * 三次批量查询而不是每仓库一次：`tags` 只能从 `projects_to_tags` 出发，而一个仓库有
 * 几个项目就有几行，一行一查就是 N+1。`projectTypes` / `categoryCode` 同理：仓库不是
 * 分类的载体，项目才是，所以都要经 `projects` 走一遍。
 *
 * **`categoryCode` 单值是从多行里挑一个**，规则是「先取已确认的，再取最早发布的那个」。
 * 先看 `category_reviewed_at` 是因为人工确认过的分类才是对外承诺的那个；没确认时按
 * `created_at` 取最早的那个，是为了让结果稳定 —— 换一个并列顺序，同一个仓库会在两次
 * 列表请求里返回不同的分类。
 */
export async function loadClassifications(
  db: Db,
  repoIds: string[]
): Promise<ClassificationMap> {
  const result: ClassificationMap = new Map()
  if (repoIds.length === 0) return result

  const rows = await db
    .select({
      repoId: projects.repoId,
      type: projects.type,
      categoryCode: categories.code,
      categoryReviewedAt: projects.categoryReviewedAt,
      createdAt: projects.createdAt,
      projectId: projects.id,
    })
    .from(projects)
    .leftJoin(categories, eq(categories.id, projects.categoryId))
    .where(inArray(projects.repoId, repoIds))
    .orderBy(projects.createdAt, projects.id)

  // 一个仓库的四轴。先填所有仓库的空壳，让没有 project 行的仓库也有条目。
  for (const repoId of repoIds) {
    result.set(repoId, {
      projectTypes: [],
      categoryCode: null,
      categoryReviewed: false,
      isPlatformProject: false,
      platformStatus: "tracked",
      tags: [],
    })
  }

  // 当前 `categoryCode` 是不是来自一条**已确认**的 project 行。分开记是因为
  // 「已确认优先」只在跨越未确认行时成立：两条都已确认时取更早的那条，所以第二次
  // 覆盖必须被挡住，否则结果会取决于 `created_at` 的排序细节，两次列表请求可能
  // 返回不同的分类。
  const reviewedCategory = new Set<string>()

  for (const row of rows) {
    const entry = result.get(row.repoId)
    if (!entry || row.repoId === null) continue

    if (row.type && !entry.projectTypes.includes(row.type)) {
      entry.projectTypes.push(row.type)
    }

    const reviewed = row.categoryReviewedAt !== null
    if (reviewed) entry.categoryReviewed = true

    if (row.categoryCode && entry.categoryCode === null) {
      entry.categoryCode = row.categoryCode
      if (reviewed) reviewedCategory.add(row.repoId)
    } else if (
      reviewed &&
      row.categoryCode &&
      !reviewedCategory.has(row.repoId)
    ) {
      // 已确认的分类优先于更早发布的未确认分类，所以这里可以覆盖一次。
      entry.categoryCode = row.categoryCode
      reviewedCategory.add(row.repoId)
    }
  }

  await loadTags(db, repoIds, result)
  return result
}

/**
 * `tags` 是公开站 /categories 的唯一分类轴，所以取的是排除榜外的那些。
 *
 * `excludeFromRankings = false` 与 `lib/public/radar.ts` 的 `PUBLIC_TAGS` 同一个条件：
 * 少了它，payload 会带出公开页上根本不存在的标签，而消费方按 payload 建了自己的
 * 标签表之后，那些标签既无法在公开页上被解释、也没法被运营解释。
 */
async function loadTags(
  db: Db,
  repoIds: string[],
  into: ClassificationMap
): Promise<void> {
  const rows = await db
    .select({ repoId: projects.repoId, code: tags.code })
    .from(projects)
    .innerJoin(projectsToTags, eq(projectsToTags.projectId, projects.id))
    .innerJoin(tags, eq(tags.id, projectsToTags.tagId))
    .where(
      and(inArray(projects.repoId, repoIds), eq(tags.excludeFromRankings, false))
    )

  for (const row of rows) {
    if (row.repoId === null) continue
    const entry = into.get(row.repoId)
    if (entry && row.code && !entry.tags.includes(row.code)) {
      entry.tags.push(row.code)
    }
  }
}

/**
 * `platformStatus`（§1.5）。
 *
 * 与 `user_repos.platform_status` 的口径一致，但这里是**算**出来的：那列只在有人提交过
 * 这个仓库时才有行，而 `GET /api/v1/repos` 要给每个仓库都报一个状态，所以按同样的
 * CASE 现场算一遍。优先级是"走到最远的那一步"而不是互斥的标志位：一个既归档又被策展
 * 的仓库报 `archived`，因为 GitHub 不会让它复活。
 */
export function platformStatusOf(
  row: { archived: boolean; projectCount: number }
): PlatformStatus {
  if (row.archived) return "archived"
  return row.projectCount > 0 ? "curated" : "tracked"
}

/** 把 SQL 读出来的那几列补成完整的四轴。 */
export function classificationOf(
  row: RepoFilterRow,
  loaded: RepoClassification | undefined
): RepoClassification {
  const platformStatus = platformStatusOf(row)
  if (!loaded) {
    return {
      projectTypes: [],
      categoryCode: null,
      categoryReviewed: false,
      isPlatformProject: row.isPlatformProject,
      platformStatus,
      tags: [],
    }
  }
  return {
    ...loaded,
    isPlatformProject: row.isPlatformProject,
    platformStatus,
  }
}

/**
 * 命中原因（§6.5 的 `matchedBy`）。
 *
 * `repoId` 不在设计文档举的那三个值里，但白名单是唯一一条「命中原因不是任何过滤器
 * 判定」的路：不给它一个值，订阅方收到一条白名单命中的记录时只能靠比对 id 才知道
 * 自己配了什么。
 */
export type MatchReason =
  | "repoId"
  | "ownSubmission"
  | "platformType"
  | "categoryCode"
  | "projectType"
  | "uncurated"

export type MatchReasonMap = Map<string, MatchReason[]>

/**
 * 每个仓库命中了第几条规则。
 *
 * 求值在 JS 里做，而 {@link repoFilterCondition} 在 SQL 里做——两者共用同一份
 * `filters` 与同一份 `resolveIncludeUncurated`，但判定代码只有一份的意义在于**默认值
 * 只在一处推导**（§6.6 陷阱一）。把这个函数接到 `repoFilterCondition` 上就会得到一
 * 个既解释不了「为什么命中」又解释不了「为什么没命中」的 OR 表达式，所以刻意分开。
 *
 * 需要的数据已经在手上：`listFilteredRepos` 读出了 `isPlatformProject` 与
 * `projectCount`，这里只补一次 project 查询（形态 + 分类 + hidden 状态）与一次
 * `user_repos` 查询。
 */
export async function loadMatchReasons(
  db: Db,
  filters: RepoFilters,
  rows: RepoFilterRow[],
  ownerUserId: string | null
): Promise<MatchReasonMap> {
  const result: MatchReasonMap = new Map()
  const repoIds = rows.map((row) => row.id)
  if (repoIds.length === 0) return result

  // 规则 1 短路：白名单里的每一条都只因为自己在名单里而命中。
  if (filters.repoIds && filters.repoIds.length > 0) {
    for (const row of rows) result.set(row.id, ["repoId"])
    return result
  }

  const own = ownerUserId ? await loadOwnSubmissions(db, repoIds, ownerUserId) : new Set<string>()
  const axes = await loadProjectAxes(db, repoIds)

  for (const row of rows) {
    const reasons: MatchReason[] = []
    const axis = axes.get(row.id)

    if (filters.includeOwnSubmissions !== false && own.has(row.id)) {
      reasons.push("ownSubmission")
    }

    if (filters.includePlatformProjects !== false && row.isPlatformProject) {
      const platformTypes = filters.platformTypes ?? []
      const hit =
        platformTypes.length === 0 ||
        (axis?.platformTypes ?? []).some((type) =>
          platformTypes.includes(type as ProjectType)
        )
      if (hit) reasons.push("platformType")
    }

    if (filters.categoryCodes && filters.categoryCodes.length > 0) {
      const codes = axis?.categoryCodes ?? []
      if (codes.some((code) => filters.categoryCodes?.includes(code))) {
        reasons.push("categoryCode")
      }
    }

    if (filters.projectTypes && filters.projectTypes.length > 0) {
      const types = axis?.projectTypes ?? []
      if (types.some((type) => filters.projectTypes?.includes(type as ProjectType))) {
        reasons.push("projectType")
      }
    }

    // 规则 6 要求的是「没有 project 行」，所以看的是行数而不是 `isPlatformProject`：
    // 一个只有 hidden 行的仓库仍然算策展过。
    if ((row.projectCount ?? 0) === 0 && resolveIncludeUncurated(filters)) {
      reasons.push("uncurated")
    }

    result.set(row.id, reasons)
  }

  return result
}

async function loadOwnSubmissions(
  db: Db,
  repoIds: string[],
  ownerUserId: string
): Promise<Set<string>> {
  const rows = await db
    .select({ repoId: userRepos.repoId })
    .from(userRepos)
    .where(and(inArray(userRepos.repoId, repoIds), eq(userRepos.userId, ownerUserId)))

  return new Set(rows.map((row) => row.repoId).filter((id): id is string => id !== null))
}

/**
 * 每个仓库的形态与分类，两组分开。
 *
 * 形态要分「全部」与「未隐藏」两份（§6.6 陷阱三）：规则 3 只看未隐藏的，规则 5 看全部，
 * 而分类同理。用一个字段承载两份语义会让 hidden 那个仓库从「按形态订阅」里消失。
 */
async function loadProjectAxes(
  db: Db,
  repoIds: string[]
): Promise<Map<string, { projectTypes: string[]; platformTypes: string[]; categoryCodes: string[] }>> {
  const result = new Map<
    string,
    { projectTypes: string[]; platformTypes: string[]; categoryCodes: string[] }
  >()

  const rows = await db
    .select({
      repoId: projects.repoId,
      type: projects.type,
      status: projects.status,
      categoryCode: categories.code,
    })
    .from(projects)
    .leftJoin(categories, eq(categories.id, projects.categoryId))
    .where(inArray(projects.repoId, repoIds))

  for (const row of rows) {
    if (!row.repoId) continue
    let entry = result.get(row.repoId)
    if (!entry) {
      entry = { projectTypes: [], platformTypes: [], categoryCodes: [] }
      result.set(row.repoId, entry)
    }
    if (row.type) {
      if (!entry.projectTypes.includes(row.type)) entry.projectTypes.push(row.type)
      if (row.status !== "hidden" && !entry.platformTypes.includes(row.type)) {
        entry.platformTypes.push(row.type)
      }
    }
    if (row.categoryCode && !entry.categoryCodes.includes(row.categoryCode)) {
      entry.categoryCodes.push(row.categoryCode)
    }
  }

  return result
}
