/**
 * 决策工作台的集成测试。
 *
 * 验的是三件纯函数验不��、而这一层做错了就会静默出错的事：
 *
 * 1. **体征快照冻结**。`addCandidate` 必须把体征**拷贝**进去。这一点无法从类型上看
 *    出来——`jsonb` 存什么都不会报错——而它坏了的后果是 §5.5 的 30/90 天回访读到今
 *    天的数字，也就是把回访唯一要问的东西抹掉。
 * 2. **跨账户不可见**。一份工作台记的是「我为什么选了 A 而不是 B」，它对另一个账户
 *    不只是无用，而是会让人以为选型是平台的判断。所以所有读写都必须按 owner 过滤，
 *    且过滤要在查询条件里。
 * 3. **对比上限是硬约束**，不是提示。超过要报错，不能静默截断。
 */

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { decisionBoards, repos, user } from "@/db/schema"
import { upsertRepo } from "@/lib/github/service/repo"
import { upsertStatsRow } from "@/lib/github/service/stats"
import { periodOf } from "@/lib/github/snapshot-dates"
import type { RepoInfo } from "@/lib/github/repo-info-query"
import {
  MAX_CANDIDATES,
  addCandidate,
  listBoards,
  listCandidates,
} from "@/lib/radar/decisions"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

const NOW = new Date("2026-03-15T04:00:00Z")
const OWNER = "decision-test"

const ALICE = "decision-alice"
const BOB = "decision-bob"

function weekStart(weeksAgo: number): Date {
  return periodOf(new Date(NOW.getTime() - weeksAgo * 7 * 86_400_000), "week")
}

function repoInfo(name: string): RepoInfo {
  return {
    name,
    fullName: `${OWNER}/${name}`,
    owner: OWNER,
    ownerId: 99,
    description: "",
    homepage: "",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-03-14T00:00:00Z"),
    defaultBranch: "main",
    stars: 1000,
    topics: [],
    archived: false,
    commitCount: 0,
    lastCommit: new Date(0),
    mentionableUsersCount: 0,
    watchersCount: 0,
    licenseSpdxId: "MIT",
    pullRequestsCount: 0,
    openIssuesCount: 0,
    releasesCount: 0,
    languages: [],
    forks: 0,
    openGraphImageUrl: "",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "",
    latestReleaseTagName: "",
    latestReleasePublishedAt: undefined,
    latestReleaseUrl: "",
    latestReleaseDescription: "",
  }
}

async function seedAccount(id: string) {
  await db
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@console.test`,
      emailVerified: true,
      role: "user",
    })
    .onConflictDoNothing()
}

/** 四周连续周历史，让 `readVitals` 能算出 `starFactor`。 */
async function seedWeeks(repoId: string, stars: number[]) {
  for (const [index, count] of stars.entries()) {
    await upsertStatsRow(
      db,
      "week",
      repoId,
      weekStart(stars.length - 1 - index),
      {
        levels: { stars: 1000 + index * count, commits: 4, releases: 0 },
        changes: { newStars: count, commits: 4, releases: 0 },
      }
    )
  }
}

describe.skipIf(!hasDatabase)("decision boards (integration)", () => {
  let repoId: string
  let otherRepoId: string

  async function seedFixtures() {
    repoId = (await upsertRepo(db, repoInfo("alpha"))).id
    otherRepoId = (await upsertRepo(db, repoInfo("beta"))).id

    await seedWeeks(repoId, [20, 22, 24, 60])
    await seedWeeks(otherRepoId, [10, 11, 12, 13])
  }

  beforeAll(async () => {
    await seedAccount(ALICE)
    await seedAccount(BOB)
    await seedFixtures()
  })

  afterAll(async () => {
    await db.delete(repos).where(eq(repos.owner, OWNER))
    await db.delete(user).where(eq(user.id, ALICE))
    await db.delete(user).where(eq(user.id, BOB))
    await pool.end()
  })

  async function newBoard(ownerId: string, title = "which runtime") {
    const [board] = await db
      .insert(decisionBoards)
      .values({ id: crypto.randomUUID(), ownerId, title })
      .returning()
    return board!
  }

  it("freezes the vitals at the moment of adding, not at the moment of reading", async () => {
    const board = await newBoard(ALICE)
    const candidate = await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: board.id,
      repoId,
    })

    expect(candidate.snapshot?.starsThisWeek).toBe(60)
    // The factor is 3 (60 against a baseline of 20 three weeks earlier), which is
    // only computable because the weeks were there when the row was written.
    expect(candidate.snapshot?.starFactor).toBe(3)
    expect(candidate.snapshot?.license).toBe("MIT")

    // Now change the underlying data. The stored copy must not move.
    await upsertStatsRow(db, "week", repoId, weekStart(0), {
      levels: { stars: 9000, commits: 40, releases: 0 },
      changes: { newStars: 8000, commits: 40, releases: 0 },
    })

    const reread = await listCandidates(db, ALICE, board.id)
    expect(reread[0]?.snapshot?.starsThisWeek).toBe(60)
  })

  it("keeps a board invisible to another account, and refuses writes to it", async () => {
    const board = await newBoard(ALICE, "private pick")
    await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: board.id,
      repoId,
    })

    // Not an error, not even an empty list from a filtered read: the board's
    // candidates are simply not reachable through a session that does not own it.
    expect(await listCandidates(db, BOB, board.id)).toEqual([])

    await expect(
      addCandidate(db, {
        id: crypto.randomUUID(),
        ownerId: BOB,
        boardId: board.id,
        repoId: otherRepoId,
      })
    ).rejects.toThrow(/No board/)
  })

  it("holds at most MAX_CANDIDATES, and reports the ceiling rather than truncating", async () => {
    const board = await newBoard(ALICE, "long shortlist")

    // Every candidate needs its own repository: `(board_id, repo_id)` is unique,
    // and a repeated repository is refused rather than counted twice — so a loop
    // over one repo would stop at the second with a duplicate, not at the ceiling.
    let firstCandidateId = ""
    for (let index = 0; index < MAX_CANDIDATES; index += 1) {
      const id = (await upsertRepo(db, repoInfo(`candidate-${index}`))).id
      await seedWeeks(id, [1, 1, 1, 1])
      await addCandidate(db, {
        id: crypto.randomUUID(),
        ownerId: ALICE,
        boardId: board.id,
        repoId: id,
      })
      if (index === 0) firstCandidateId = id
    }

    expect(await listCandidates(db, ALICE, board.id)).toHaveLength(
      MAX_CANDIDATES
    )

    const overflowId = (await upsertRepo(db, repoInfo("one-too-many"))).id
    await seedWeeks(overflowId, [1, 1, 1, 1])
    await expect(
      addCandidate(db, {
        id: crypto.randomUUID(),
        ownerId: ALICE,
        boardId: board.id,
        repoId: overflowId,
      })
    ).rejects.toThrow(/at most/)

    // The refusal must not have cost the reader a slot: the shortlist is still
    // whole, and the repository they wanted is not half-added.
    const after = await listCandidates(db, ALICE, board.id)
    expect(after).toHaveLength(MAX_CANDIDATES)
    expect(after.some((row) => row.repoId === overflowId)).toBe(false)

    // A duplicate on a full board is reported as the duplicate, not as the
    // ceiling. Both are true at once, and "先移出一个再加" would send the reader
    // to remove a candidate in order to add one they never added twice.
    await expect(
      addCandidate(db, {
        id: crypto.randomUUID(),
        ownerId: ALICE,
        boardId: board.id,
        repoId: firstCandidateId,
      })
    ).rejects.toThrow(/already a candidate/)

    // `afterAll` already removes every repository under OWNER, so the fixtures
    // for the remaining cases are reseeded here rather than cleaned up inline.
    // A mid-file `delete(repos)` would take the shared `alpha` and `beta` with
    // it and make the remaining tests fail for a reason of their own.
    await seedFixtures()
  })

  it("refuses the same repository twice, and leaves the board unchanged", async () => {
    // Refused rather than answered with the row that is already there. Returning
    // it made a repeated add look like it worked while the board stayed the same
    // size — and under the ceiling that hid the problem entirely, because a
    // five-entry shortlist with two entries added twice reads as a full one.
    const board = await newBoard(ALICE, "double click")
    await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: board.id,
      repoId,
    })

    await expect(
      addCandidate(db, {
        id: crypto.randomUUID(),
        ownerId: ALICE,
        boardId: board.id,
        repoId,
      })
    ).rejects.toThrow(/already a candidate/)

    // One row, not two, and not an empty board left behind by a partial write.
    const rows = await listCandidates(db, ALICE, board.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.repoId).toBe(repoId)
  })

  it("puts the newest candidate first, so a shortlist stays read from the front", async () => {
    const board = await newBoard(ALICE, "ordering")
    await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: board.id,
      repoId,
    })
    await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: board.id,
      repoId: otherRepoId,
    })

    const rows = await listCandidates(db, ALICE, board.id)
    expect(rows.map((row) => row.repoId)).toEqual([otherRepoId, repoId])
  })

  it("counts each board's candidates in the list, and counts a board with none", async () => {
    const empty = await newBoard(ALICE, "counting: none yet")
    const two = await newBoard(ALICE, "counting: two of them")

    await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: two.id,
      repoId,
    })
    await addCandidate(db, {
      id: crypto.randomUUID(),
      ownerId: ALICE,
      boardId: two.id,
      repoId: otherRepoId,
    })

    const counts = new Map(
      (await listBoards(db, ALICE)).map((board) => [
        board.id,
        board.candidateCount,
      ])
    )

    // Having no candidates is the state a board is in for the whole of the time
    // between creating it and adding the first one, so a board in that state has
    // to stay in the list — dropping it would make "just created" read as "does
    // not exist".
    expect(counts.get(empty.id)).toBe(0)
    expect(counts.get(two.id)).toBe(2)

    // The count rides on the board's own ownership rather than on the candidates'
    // rows being reachable, so another account's list is empty, not just its
    // counts.
    expect(await listBoards(db, BOB)).toEqual([])
  })
})
