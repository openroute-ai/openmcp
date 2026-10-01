/**
 * 决策工作台的数据访问层。
 *
 * 设计文档 §10 的 v0 写了「砍掉：决策工作台 5 步流程」，落地页却在营销它。所以
 * 这里落的是**轻量版**，而轻量版唯一的硬性要求写在 §5.5：「生成报告不是终点，指
 * 标是决策对了没有」——要回答那个问题，需要的是一份**冻结下来的候选与当时的体
 * 征**，不是一个流程引擎。流程可以后补，冻结下来的那一瞬间补不回来。
 *
 * 因此这一层只有两件事：候选清单，和每加一个候选时把体征**拷贝**进去。后者是
 * {@link addCandidate} 里那次 `readVitals` 的全部意义。
 */

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm"
import {
  DECISION_VERDICTS,
  decisionBoards,
  decisionCandidates,
  repos,
} from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import { readVitals, type VitalSnapshot } from "./vitals"

/**
 * 一次对比最多放几个候选。
 *
 * 上限是 5，不是 20，也���是「不限制」。理由是这份清单的唯一读者是正在做选型的人，
 * 而一个人认真对比到第五个之后就不再做判断了——他在挑一个自己准备相信的答案。
 * 把第五个之后的藏起来，是为了让「我只看了 3 个」这件事不必由一个人主动承认。
 *
 * 与 §10「砍掉 5 步流程」不矛盾：被砍掉的是**流程**，不是**对比**。
 */
export const MAX_CANDIDATES = 5

/** 一份工作台，不含候选。 */
export type Board = typeof decisionBoards.$inferSelect

/** 一个候选，连同它冻结的体征与仓库标识。 */
export interface Candidate {
  id: string
  boardId: string
  repoId: string
  verdict: (typeof DECISION_VERDICTS)[number]
  note: string | null
  position: number
  snapshot: VitalSnapshot | null
  createdAt: Date
  updatedAt: Date
  /** 仓库标识，用于渲染与跳转。 */
  owner: string
  name: string
  stars: number | null
  description: string | null
}

/**
 * 这个账户名下的工作台，最近动过的在前。
 *
 * `owner_id` 是查询条件而不是过滤后校验——两者在结果上一样，但后者的写法会先读出
 * 别人的行再丢掉，而那是一个「忘了加条件」就能变成数据泄漏的形状。
 */
export async function listBoards(db: Db, ownerId: string): Promise<Board[]> {
  return db
    .select()
    .from(decisionBoards)
    .where(eq(decisionBoards.ownerId, ownerId))
    .orderBy(desc(decisionBoards.updatedAt))
}

/** 一个工作台；不属于 `ownerId` 时返回 null。 */
export async function getBoard(
  db: Db,
  ownerId: string,
  boardId: string
): Promise<Board | null> {
  const [board] = await db
    .select()
    .from(decisionBoards)
    .where(
      and(eq(decisionBoards.id, boardId), eq(decisionBoards.ownerId, ownerId))
    )
    .limit(1)

  return board ?? null
}

/**
 * 一个工作台的候选，按人工排序。
 *
 * `ORDER BY position, created_at` 而不是按 verdict 的枚举序：枚举顺序是分类的顺序，
 * 而读者需要的是「我排的顺序」——把「待评审」排在「已通过」前面会让一份工作台看
 * 起来比实际更不完整，而那会改变这个人的下一步动作。
 */
export async function listCandidates(
  db: Db,
  ownerId: string,
  boardId: string
): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: decisionCandidates.id,
      boardId: decisionCandidates.boardId,
      repoId: decisionCandidates.repoId,
      verdict: decisionCandidates.verdict,
      note: decisionCandidates.note,
      position: decisionCandidates.position,
      snapshot: decisionCandidates.snapshot,
      createdAt: decisionCandidates.createdAt,
      updatedAt: decisionCandidates.updatedAt,
      owner: repos.owner,
      name: repos.name,
      stars: repos.stars,
      description: repos.description,
    })
    .from(decisionCandidates)
    .innerJoin(repos, eq(repos.id, decisionCandidates.repoId))
    // The board's ownership is part of the join condition rather than a separate
    // lookup, so a candidate can never be read through a board belonging to
    // somebody else: there is no intermediate state in which the board id is
    // known but not yet checked.
    .innerJoin(
      decisionBoards,
      and(
        eq(decisionBoards.id, decisionCandidates.boardId),
        eq(decisionBoards.ownerId, ownerId)
      )
    )
    .where(eq(decisionCandidates.boardId, boardId))
    .orderBy(
      asc(decisionCandidates.position),
      asc(decisionCandidates.createdAt)
    )

  return rows.map((row) => toCandidate(row, row))
}

/** 新建一个工作台。 */
export async function createBoard(
  db: Db,
  input: { id: string; ownerId: string; title: string; summary?: string | null }
): Promise<Board> {
  const [board] = await db
    .insert(decisionBoards)
    .values({
      id: input.id,
      ownerId: input.ownerId,
      title: input.title,
      summary: input.summary ?? null,
    })
    .returning()

  return board!
}

/**
 * 把一个仓库加进候选，并**冻结**它此刻的体征。
 *
 * 这是整个轻量工作台里唯一一处不可逆的写入，也是它唯一不可逆的理由：体征存的是
 * 一份拷贝，半年后回看读到的是「当时它什么样」。如果这里改成引用实时计算，§5.5 的
 * 30/90 天回访就会读到今天的数字，而那恰好把回访唯一要问的东西抹掉了。
 *
 * 仓库不存在时抛错而不是静默跳过：一个被写进候选但查不到仓库的行，会在对比视图里
 * 显示成空白，而空白在选型场景里读起来像「数据还没同步」。
 */
export async function addCandidate(
  db: Db,
  input: { id: string; ownerId: string; boardId: string; repoId: string }
): Promise<Candidate> {
  const [repo] = await db
    .select()
    .from(repos)
    .where(eq(repos.id, input.repoId))
    .limit(1)

  if (!repo) {
    throw new Error(`No repository with id ${input.repoId}`)
  }

  // Ownership is checked before anything is written, and the board id never
  // travels to the database unverified. `decision_candidates.board_id` is a plain
  // foreign key with no ownership of its own, so without this the table would
  // accept any write naming any board — including someone else's.
  const [board] = await db
    .select({ id: decisionBoards.id })
    .from(decisionBoards)
    .where(
      and(
        eq(decisionBoards.id, input.boardId),
        eq(decisionBoards.ownerId, input.ownerId)
      )
    )
    .limit(1)

  if (!board)
    throw new Error(`No board ${input.boardId} owned by ${input.ownerId}`)

  const [dupe] = await db
    .select()
    .from(decisionCandidates)
    .where(
      and(
        eq(decisionCandidates.boardId, input.boardId),
        eq(decisionCandidates.repoId, input.repoId)
      )
    )
    .limit(1)

  // Checked before the limit so that re-adding a repository that is already on
  // the board is idempotent rather than an error: a double-click on a full
  // shortlist should read as "already there", not as "you hit the ceiling" — the
  // first tells the reader nothing new, the second tells them something false.
  if (dupe) return toCandidate(dupe, repo)

  const count = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(decisionCandidates)
    .where(eq(decisionCandidates.boardId, input.boardId))

  const existing = Number(count[0]?.n ?? 0)
  if (existing >= MAX_CANDIDATES) {
    throw new Error(
      `A board holds at most ${MAX_CANDIDATES} candidates; remove one before adding another`
    )
  }

  const snapshot = await readVitals(db, repo, new Date())

  const [row] = await db
    .insert(decisionCandidates)
    .values({
      id: input.id,
      boardId: input.boardId,
      repoId: input.repoId,
      // Above every existing row. `position` exists only to order, so counting
      // down from zero is enough and needs no re-indexing of the rows already
      // there — which matters because the alternative reorders a board someone
      // is reading while they read it.
      position: -existing - 1,
      snapshot,
    })
    .returning()

  if (!row) throw new Error("Candidate insert returned nothing")
  return toCandidate(row, repo)
}

function toCandidate(
  row: typeof decisionCandidates.$inferSelect,
  repo: Pick<
    typeof repos.$inferSelect,
    "owner" | "name" | "stars" | "description"
  >
): Candidate {
  return {
    ...row,
    snapshot: (row.snapshot as VitalSnapshot | null) ?? null,
    owner: repo.owner,
    name: repo.name,
    stars: repo.stars,
    description: repo.description,
  }
}

/** 改一个候选的处置与备注。 */
export async function updateCandidate(
  db: Db,
  input: {
    ownerId: string
    candidateId: string
    verdict?: (typeof DECISION_VERDICTS)[number]
    note?: string | null
    position?: number
  }
): Promise<Candidate | null> {
  const [row] = await db
    .update(decisionCandidates)
    .set({
      ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    })
    .where(
      and(
        eq(decisionCandidates.id, input.candidateId),
        sql`exists (
          select 1 from ${decisionBoards}
          where ${decisionBoards.id} = ${decisionCandidates.boardId}
            and ${decisionBoards.ownerId} = ${input.ownerId}
        )`
      )
    )
    .returning()

  if (!row) return null

  const [repo] = await db
    .select({
      owner: repos.owner,
      name: repos.name,
      stars: repos.stars,
      description: repos.description,
    })
    .from(repos)
    .where(eq(repos.id, row.repoId))
    .limit(1)

  if (!repo) return null
  return toCandidate(row, repo)
}

/** 移出一个候选。留痕在 `note` 与体征快照里，删除本身不需要被追溯。 */
export async function removeCandidate(
  db: Db,
  input: { ownerId: string; candidateId: string }
): Promise<boolean> {
  const rows = await db
    .delete(decisionCandidates)
    .where(
      and(
        eq(decisionCandidates.id, input.candidateId),
        sql`exists (
          select 1 from ${decisionBoards}
          where ${decisionBoards.id} = ${decisionCandidates.boardId}
            and ${decisionBoards.ownerId} = ${input.ownerId}
        )`
      )
    )
    .returning({ id: decisionCandidates.id })

  return rows.length > 0
}

/**
 * 写下结论，并把状态推进到 `decided`。
 *
 * `decidedAt` 只在这次调用里取，不从客户端收：它是回访计时的起点，而客户端可以送出
 * 任意时间。让一个「上周就决定了」的记录带着上周的时间进来，会让 30 天回访从第一天
 * 就开始算起。
 *
 * 重复调用会**覆盖** `outcome` 与 `decidedAt`。这不是幂等的，但它是诚实的：改主意
 * 就是改主意，而 `updatedAt` 会留下痕迹。
 */
export async function recordOutcome(
  db: Db,
  input: {
    ownerId: string
    boardId: string
    outcome: string
    decidedAt: Date
  }
): Promise<Board | null> {
  const [board] = await db
    .update(decisionBoards)
    .set({
      outcome: input.outcome,
      decidedAt: input.decidedAt,
      status: "decided",
    })
    .where(
      and(
        eq(decisionBoards.id, input.boardId),
        eq(decisionBoards.ownerId, input.ownerId)
      )
    )
    .returning()

  return board ?? null
}

/** 改一个工作台的标题、背景或状态。 */
export async function updateBoard(
  db: Db,
  input: {
    ownerId: string
    boardId: string
    title?: string
    summary?: string | null
    status?: (typeof decisionBoards.$inferSelect)["status"]
  }
): Promise<Board | null> {
  const [board] = await db
    .update(decisionBoards)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })
    .where(
      and(
        eq(decisionBoards.id, input.boardId),
        eq(decisionBoards.ownerId, input.ownerId)
      )
    )
    .returning()

  return board ?? null
}

/**
 * 为候选选择器搜仓库。
 *
 * 搜**整个**登记表而不只是「这个账户加过的那些」：一份候选清单是在全站的项目里挑，
 * 而一个只列自己提交过仓库的选择器会让人无法对比别人的项目——那正好是这个工具存在
 * 的理由。它仍然要求登录，因为它是工作台的一部分，而工作台的数据没有共享的部分。
 *
 * 归档仓库被排除。它们不再是可选项，而把一个不可选项放进选择器只会浪费一次点击。
 */
export async function searchCandidateRepos(
  db: Db,
  input: { search?: string; limit?: number }
): Promise<
  {
    id: string
    owner: string
    name: string
    stars: number | null
    description: string | null
  }[]
> {
  const term = input.search?.trim()

  return db
    .select({
      id: repos.id,
      owner: repos.owner,
      name: repos.name,
      stars: repos.stars,
      description: repos.description,
    })
    .from(repos)
    .where(
      and(
        sql`${repos.archived} is not true`,
        // Empty search lists the most-starred, which is the useful default for
        // someone opening the picker without a name in mind.
        term
          ? or(
              ilike(repos.owner, `%${term}%`),
              ilike(repos.name, `%${term}%`),
              ilike(repos.description, `%${term}%`)
            )
          : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${repos.stars}, 0)`))
    .limit(Math.min(input.limit ?? 20, 50))
}
