/**
 * 决策工作台的 tRPC 端点。
 *
 * 全部 `protectedProcedure`。这不是保守，是因为这份数据**没有任何共享的部分**：
 * 一份工作台记的是「我为什么在 2026 年 3 月选了 A 而不是 B」，它对另一个账户不
 * 只无用，而且是负资产——它会让人以为选型是平台的判断。所以每个读写都按
 * `ctx.session.user.id` 过滤，且过滤写在查询条件里（见 `decisions.ts`）而不是读出来
 * 之后再比。
 *
 * 端点是薄的：所有判断（对比上限、去重、所有权、快照时机）都在
 * `lib/radar/decisions.ts` 里。这个 router 只做三件路由层该做的事：认证、把 zod 的
 * 结果翻译成入参、把服务的错误翻译成 tRPC 的错误码。
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { DECISION_VERDICTS } from "@/db/schema"
import {
  MAX_CANDIDATES,
  addCandidate,
  createBoard,
  getBoard,
  listBoards,
  listCandidates,
  recordOutcome,
  removeCandidate,
  searchCandidateRepos,
  updateBoard,
  updateCandidate,
} from "@/lib/radar/decisions"
import { createTRPCRouter, protectedProcedure } from "../init"
import { ERROR_CODES } from "@/lib/trpc/error-codes"

const verdict = z.enum(DECISION_VERDICTS)

/** PostgreSQL 的 unique violation，唯一索引兜底时的那一个错误码。 */
const PG_UNIQUE_VIOLATION = "23505"

/** 本层自己生成的 id，与 tRPC 的调用 id 无关，避免客户端能指定它。 */
function newId(): string {
  return crypto.randomUUID()
}

/**
 * 服务层的 `Error` 里只有三种：找不到，以及这块板子此刻不接受这一行。
 *
 * 后者有两种说法——已经满了，以及这个仓库已经在候选里——都是 `CONFLICT`：行和身
 * 份都没问题，只是这一刻写不进去。重复的那一种另带一个 `appCode`，因为它是用户在
 * 界面上**自己会撞到**的一种失败（重复点击，或者同一份工作台开在两个标签页里），
 * 界面把它翻译成读者的语言，而不是把服务层的英文原样弹出来。
 *
 * 重复还认数据库的约束，而不只认服务层那一次查重：两个标签页可以同时通过查重然后
 * 一起写进去，落败的那一个撞上的是 `decision_candidates_board_repo_unique`。查重是
 * 为了给出人话，唯一索引才是保证，两件事各管一段。
 */
function asTrpcError(error: unknown): never {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined

  if (code === PG_UNIQUE_VIOLATION) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "that repository is already a candidate on this board",
      cause: { code: ERROR_CODES.duplicateCandidate },
    })
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("already a candidate")) {
    throw new TRPCError({
      code: "CONFLICT",
      message,
      cause: { code: ERROR_CODES.duplicateCandidate },
    })
  }
  if (message.includes("at most")) {
    throw new TRPCError({ code: "CONFLICT", message })
  }
  throw new TRPCError({ code: "NOT_FOUND", message })
}

export const decisionsRouter = createTRPCRouter({
  /**
   * 这个账户的工作台清单。
   *
   * 带上候选上限，是为了让列表页把计数读作「2 / 5」而不用在前端复制一份常量。
   * 上限是产品决定（见 `MAX_CANDIDATES` 的注释），复制一份迟早会只改一处。
   */
  list: protectedProcedure.query(async ({ ctx }) => ({
    boards: await listBoards(ctx.db, ctx.session.user.id),
    maxCandidates: MAX_CANDIDATES,
  })),

  /** 一个工作台，含它的候选与各自冻结的体征。 */
  read: protectedProcedure
    .input(z.object({ boardId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const board = await getBoard(ctx.db, ctx.session.user.id, input.boardId)
      // Not distinguishing "no such board" from "not yours": telling them apart
      // would confirm the existence of another account's board, which is the only
      // thing a probe of this endpoint could learn.
      if (!board) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such board" })
      }
      return {
        board,
        candidates: await listCandidates(ctx.db, ctx.session.user.id, board.id),
        maxCandidates: MAX_CANDIDATES,
      }
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        summary: z.string().trim().max(4_000).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      createBoard(ctx.db, {
        id: newId(),
        ownerId: ctx.session.user.id,
        title: input.title,
        summary: input.summary ?? null,
      })
    ),

  update: protectedProcedure
    .input(
      z.object({
        boardId: z.string().min(1),
        title: z.string().trim().min(1).max(200).optional(),
        summary: z.string().trim().max(4_000).nullable().optional(),
        status: z.enum(["collecting", "reviewing", "decided"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const board = await updateBoard(ctx.db, {
        ownerId: ctx.session.user.id,
        boardId: input.boardId,
        title: input.title,
        summary: input.summary,
        status: input.status,
      })
      if (!board) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such board" })
      }
      return board
    }),

  /**
   * 写下结论。
   *
   * 这一步**不会**把某个候选的 `verdict` 改成 `chosen`——那两件事在
   * `decisionBoards.outcome` 的注释里被刻意留成独立的：前者是当时的说法，后者是候
   * 选行上的状态。两者可以不一致，而不一致时的信息量比强制一致时更大。
   */
  decide: protectedProcedure
    .input(
      z.object({
        boardId: z.string().min(1),
        outcome: z.string().trim().min(1).max(4_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const board = await recordOutcome(ctx.db, {
        ownerId: ctx.session.user.id,
        boardId: input.boardId,
        outcome: input.outcome,
        // Server-side, always: `decidedAt` starts the §5.5 callback clock, and a
        // client-supplied date would let a record claim it was decided last week.
        decidedAt: new Date(),
      })
      if (!board) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such board" })
      }
      return board
    }),

  /** 加一个候选，并在写入前冻结它此刻的体征。 */
  addCandidate: protectedProcedure
    .input(
      z.object({
        boardId: z.string().min(1),
        repoId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await addCandidate(ctx.db, {
          id: newId(),
          ownerId: ctx.session.user.id,
          boardId: input.boardId,
          repoId: input.repoId,
        })
      } catch (error) {
        asTrpcError(error)
      }
    }),

  updateCandidate: protectedProcedure
    .input(
      z.object({
        candidateId: z.string().min(1),
        verdict: verdict.optional(),
        note: z.string().trim().max(4_000).nullable().optional(),
        position: z.number().int().min(-100).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const candidate = await updateCandidate(ctx.db, {
        ownerId: ctx.session.user.id,
        candidateId: input.candidateId,
        verdict: input.verdict,
        note: input.note,
        position: input.position,
      })
      if (!candidate) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such candidate" })
      }
      return candidate
    }),

  removeCandidate: protectedProcedure
    .input(z.object({ candidateId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (
        !(await removeCandidate(ctx.db, {
          ownerId: ctx.session.user.id,
          candidateId: input.candidateId,
        }))
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such candidate" })
      }
      return { ok: true as const }
    }),

  /**
   * 为候选选择器搜仓库。
   *
   * 搜整个登记表，不只搜这个账户加过的那批：候选清单是在全站项目里挑，而一个只列
   * 自己提交仓库的选择器会让人没法对比别人的项目。
   */
  searchRepos: protectedProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
    )
    .query(({ ctx, input }) =>
      searchCandidateRepos(ctx.db, { search: input.search, limit: input.limit })
    ),
})
