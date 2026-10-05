/**
 * 仓库行的形状：`GET /api/v1/repos` 的列表项与 `GET /api/v1/repos/{id}` 的档案。
 *
 * 两个端点共用一份序列化，所以「列表里能看到什么」与「详情里能看到什么」不可能漂。
 * 列表项本身**带上分类四轴**：过滤器就是拿这四轴判定的，不给调用方看到它们，调用方
 * 就没法自己验一遍「为什么这个仓库命中了」。
 */
import { and, eq, gt, sql } from "drizzle-orm"
import { projects, repos } from "@/db/schema"
import type { repoListItemSchema, repoProfileSchema } from "@/lib/api/contract"
import type { z } from "zod"
import { encodeRepoCursor } from "@/lib/api/pagination"
import {
  classificationOf,
  loadClassifications,
  repoScopeCondition,
  type RepoClassification,
  type RepoFilters,
} from "@/lib/api/repo-filter"
import type { Db } from "@/lib/github/service/repo"

export type RepoListItem = z.output<typeof repoListItemSchema>
export type RepoProfile = z.output<typeof repoProfileSchema>

/**
 * 读出来的列。
 *
 * `archived` 走 `coalesce`：列可空，而契约说它必须是布尔。`null` 在这张表里的含义是
 * 「GitHub 没报过这个字段」，对「是不是归档」这个问题只有一个可用答案 —— false。
 *
 * `projectCount` 与 `isPlatformProject` 用子查询而不是 join 后 group by：前者要的是
 * 「有几行」，后者要的是「有没有」，两者在多 project 的仓库上会给出不同答案，而
 * group by 会把它们合并成一行。
 */
const REPO_COLUMNS = {
  id: repos.id,
  name: repos.name,
  owner: repos.owner,
  ownerId: repos.ownerId,
  description: repos.description,
  homepage: repos.homepage,
  stars: repos.stars,
  forks: repos.forks,
  watchersCount: repos.watchersCount,
  topics: repos.topics,
  languages: repos.languages,
  licenseSpdxId: repos.licenseSpdxId,
  defaultBranch: repos.defaultBranch,
  createdAt: repos.createdAt,
  pushedAt: repos.pushedAt,
  lastCommit: repos.lastCommit,
  commitCount: repos.commitCount,
  contributorCount: repos.contributorCount,
  mentionableUsersCount: repos.mentionableUsersCount,
  pullRequestsCount: repos.pullRequestsCount,
  releasesCount: repos.releasesCount,
  openIssuesCount: repos.openIssuesCount,
  openGraphImageUrl: repos.openGraphImageUrl,
  iconUrl: repos.iconUrl,
  latestReleaseName: repos.latestReleaseName,
  latestReleaseTagName: repos.latestReleaseTagName,
  latestReleasePublishedAt: repos.latestReleasePublishedAt,
  latestReleaseUrl: repos.latestReleaseUrl,
  archived: sql<boolean>`coalesce(${repos.archived}, false)`,
  projectCount: sql<number>`(select count(*)::int from ${projects} p where p.repo_id = ${repos.id})`,
  isPlatformProject: sql<boolean>`exists (
    select 1 from ${projects} p where p.repo_id = ${repos.id} and p.status <> 'hidden'
  )`,
}

type RepoQueryRow = {
  [K in keyof typeof REPO_COLUMNS]: unknown
} & { id: string }

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function stringsOrEmpty(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : []
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function date(value: unknown): string {
  return (value as Date).toISOString()
}

/**
 * 一行 → 列表项。
 *
 * `topics` 与 `languages` 都是可空的 jsonb 列，缺省给 `[]` 而不是 `null`：调用方拿到
 * `null` 时必须再判一次，而「这个仓库没有话题」和「我们没采到话题」在这张表里分不开，
 * 所以只有一种诚实的形状。
 */
function toListItem(
  row: RepoQueryRow,
  classifications: Map<string, RepoClassification>
): RepoListItem {
  const owner = row.owner as string
  const name = row.name as string
  const archived = row.archived === true

  return {
    id: row.id,
    fullName: `${owner}/${name}`,
    description: (row.description ?? null) as string | null,
    repoUrl: `https://github.com/${owner}/${name}`,
    topics: stringsOrEmpty(row.topics as string[] | null),
    languages: stringsOrEmpty(row.languages as string[] | null),
    licenseSpdxId: (row.licenseSpdxId ?? null) as string | null,
    stars: numberOrNull(row.stars),
    forks: numberOrNull(row.forks),
    subscribersCount: numberOrNull(row.watchersCount),
    openIssuesCount: numberOrNull(row.openIssuesCount),
    defaultBranch: (row.defaultBranch ?? null) as string | null,
    archived,
    createdAt: date(row.createdAt),
    pushedAt: isoOrNull(row.pushedAt as Date | null),
    lastCommit: isoOrNull(row.lastCommit as Date | null),
    classification: classificationOf(
      {
        id: row.id,
        archived,
        projectCount: numberOrNull(row.projectCount) ?? 0,
        isPlatformProject: row.isPlatformProject === true,
      },
      classifications.get(row.id)
    ),
    projectCount: numberOrNull(row.projectCount) ?? 0,
  }
}

/**
 * 可见且命中过滤器的仓库，按 id 升序。
 *
 * **没有分页**（设计文档 §6.6 只给了过滤器，`limit` / `cursor` 只出现在统计端点）。
 * `ORDER BY id` 是刻意的：响应顺序稳定，客户端两次请求看到的差别就只来自数据本身。
 */
export type RepoListPage = {
  items: RepoListItem[]
  /** 下一页的起点游标；`null` 表示这是最后一页。 */
  nextCursor: string | null
  /** 命中的总数，与 `limit` 无关。 */
  total: number
}

export async function listRepoItems(
  db: Db,
  filters: RepoFilters,
  ownerUserId: string | null,
  page: { limit: number; cursor?: string } = { limit: 50 }
): Promise<RepoListPage> {
  const scope = repoScopeCondition(filters, ownerUserId)
  const after = page.cursor ? and(scope, gt(repos.id, page.cursor)) : scope

  // `limit + 1`：多取一行来分辨"还有下一页"与"这一页刚好填满"。改成先 `count(*)`
  // 再比长度要多付一次全表扫描，而这就是多取一行的全部理由。
  const fetched = (await db
    .select(REPO_COLUMNS)
    .from(repos)
    .where(after)
    .orderBy(repos.id)
    .limit(page.limit + 1)) as RepoQueryRow[]

  const hasMore = fetched.length > page.limit
  const rows = hasMore ? fetched.slice(0, page.limit) : fetched

  const [classifications, [totalRow]] = await Promise.all([
    loadClassifications(db, rows.map((row) => row.id)),
    // 总数按**同一个 scope**数，不含游标条件：调用方要的是"这个过滤条件一共命中多少"，
    // 而含了游标的 count 回答的是"还有多少"，两个数都会被当成 total 用错。
    db.select({ count: sql<number>`count(*)::int` }).from(repos).where(scope),
  ])

  const last = rows[rows.length - 1]
  return {
    items: rows.map((row) => toListItem(row, classifications)),
    // 游标指向**这一页最后一行**，不是多取的那一行：多取它的作用只是判断还有没有。
    nextCursor: hasMore && last ? encodeRepoCursor(last.id) : null,
    total: totalRow?.count ?? 0,
  }
}

/** 单个仓库的档案。找不到返回 undefined，由路由决定报不报 404。 */
export async function getRepoProfile(
  db: Db,
  repoId: string
): Promise<RepoProfile | undefined> {
  const [row] = (await db
    .select(REPO_COLUMNS)
    .from(repos)
    .where(eq(repos.id, repoId))
    .limit(1)) as RepoQueryRow[]

  if (!row) return undefined

  const classifications = await loadClassifications(db, [row.id])
  const list = toListItem(row, classifications)

  return {
    ...list,
    owner: row.owner as string,
    ownerId: numberOrNull(row.ownerId) ?? 0,
    name: row.name as string,
    homepage: (row.homepage ?? null) as string | null,
    contributorCount: numberOrNull(row.contributorCount),
    commitCount: numberOrNull(row.commitCount),
    mentionableUsersCount: numberOrNull(row.mentionableUsersCount),
    pullRequestsCount: numberOrNull(row.pullRequestsCount),
    releasesCount: numberOrNull(row.releasesCount),
    latestReleaseName: (row.latestReleaseName ?? null) as string | null,
    latestReleaseTagName: (row.latestReleaseTagName ?? null) as string | null,
    latestReleasePublishedAt: isoOrNull(
      row.latestReleasePublishedAt as Date | null
    ),
    latestReleaseUrl: (row.latestReleaseUrl ?? null) as string | null,
    openGraphImageUrl: (row.openGraphImageUrl ?? null) as string | null,
    iconUrl: (row.iconUrl ?? null) as string | null,
  }
}