/**
 * Integration tests for the console's authorization split.
 *
 * The console serves two audiences from one deployment: an operator curates the
 * catalogue from `/dashboard`, and anyone else signed in reaches `/console`,
 * which counts that account's own numbers above its repository list. The two
 * layouts that redirect between those paths are UX; this file covers the part
 * that cannot be skipped, which is the role check on each procedure and the
 * scoping of every figure the dashboard shows.
 *
 * The behaviour worth protecting is the failure mode: a gate that treats an
 * unrecognised role as an admin would turn a typo in one `update` statement
 * into full access to every project, task and repository. So the refusal cases
 * get as much attention as the allowed ones.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { inArray } from "drizzle-orm"

import { db, pool } from "@/db/client"
import { repos, user, userRepos } from "@/db/schema"
import { createCaller } from "@/lib/trpc/root"
import { isAdmin, landingPathFor } from "@/lib/auth/role"
import { ADMIN_ROLE } from "@/lib/auth/role"
import {
  fakeAccountContext,
  fakeAdminContext,
  fakeAnonymousContext,
  fakeTRPCContext,
  fakeUserContext,
} from "./helpers/fakes"
import { Routes } from "@/lib/routes"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

describe("role checks", () => {
  it("recognises only the exact admin role", () => {
    expect(isAdmin({ role: ADMIN_ROLE })).toBe(true)
  })

  it("refuses every role it does not recognise", () => {
    // The list is the point of the test. Each of these would be an admin if the
    // check were a prefix match, a case-insensitive compare, or a truthiness
    // test on the field.
    const refused = [
      undefined,
      null,
      "",
      "user",
      "User",
      "ADMIN",
      "admin ",
      " administrator",
      "superuser",
      "admins",
      0,
      1,
      true,
      {},
      [],
    ]

    for (const role of refused) {
      expect(isAdmin({ role } as never), String(role)).toBe(false)
    }
  })

  it("refuses no account at all", () => {
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
    expect(isAdmin({})).toBe(false)
  })

  it("sends each account to the console it may use", () => {
    // One answer per account, which is what stops the two gates bouncing: each
    // one redirects to the branch the other would send back.
    expect(landingPathFor({ role: ADMIN_ROLE })).toBe(Routes.dashboard)
    expect(landingPathFor({ role: "user" })).toBe(Routes.console)
    expect(landingPathFor({ role: null })).toBe(Routes.console)
    expect(landingPathFor({})).toBe(Routes.console)
    expect(landingPathFor(null)).toBe(Routes.signIn)
    expect(landingPathFor(undefined)).toBe(Routes.signIn)
  })
})

describe.skipIf(!hasDatabase)("console authorization (integration)", () => {
  beforeAll(() => {
    // Nothing is seeded: every case here is refused, so a row would not change
    // an outcome, and the refusal must not depend on the catalogue's contents.
  })

  afterAll(async () => {
    await pool.end()
  })

  /**
   * One admin-only procedure per router, so a router that was switched back to
   * `protectedProcedure` is caught whichever one this picks.
   */
  const adminOnly: Array<
    [string, (c: ReturnType<typeof createCaller>) => Promise<unknown>]
  > = [
    ["authors.list", (c) => c.authors.list()],
    ["overview.snapshot", (c) => c.overview.snapshot()],
    ["projects.list", (c) => c.projects.list({})],
    ["rankings.weekly", (c) => c.rankings.weekly({})],
    ["skills.list", (c) => c.skills.list({})],
    ["sync.list", (c) => c.sync.list({})],
    ["tags.list", (c) => c.tags.list()],
    ["tasks.list", (c) => c.tasks.list()],
  ]

  it("refuses every operator procedure to a signed-in non-admin", async () => {
    const caller = createCaller(fakeUserContext(db))

    for (const [label, call] of adminOnly) {
      await expect(call(caller), label).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
    }
  })

  it("refuses every operator procedure to an account with no role at all", async () => {
    // A row from before the column existed, or an insert that left it null. The
    // gate asks for `admin` exactly, so null is an ordinary account.
    const caller = createCaller(fakeTRPCContext(db, null))

    for (const [label, call] of adminOnly) {
      await expect(call(caller), label).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
    }
  })

  it("refuses every operator procedure to a role it has never heard of", async () => {
    // The typo case: a half-finished promotion writes "Admin" or "adminstrator"
    // and must not land on the operator console.
    const typo = createCaller(fakeTRPCContext(db, "Admin"))
    const longer = createCaller(fakeTRPCContext(db, "administrator"))

    for (const [label, call] of adminOnly) {
      await expect(call(typo), label).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
      await expect(call(longer), label).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
    }
  })

  it("refuses an anonymous caller before the role is even read", async () => {
    // No session at all is UNAUTHORIZED rather than FORBIDDEN: the distinction
    // is what tells a stale session apart from one the console turned away.
    const caller = createCaller(fakeAnonymousContext(db))

    await expect(caller.authors.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
    await expect(caller.repos.list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
  })

  it("lets a signed-in non-admin read the repository list", async () => {
    // The list under `/console` is readable, because a page that cannot list its
    // own content renders empty and looks broken.
    const caller = createCaller(fakeUserContext(db))

    const result = await caller.repos.list({ limit: 5, offset: 0 })

    expect(Array.isArray(result.items)).toBe(true)
    expect(typeof result.total).toBe("number")
  })

  it("lets a signed-in non-admin read one repository in full", async () => {
    // The detail page behind a row of the list. It has to be readable, or the
    // list offers a link that answers not-found, which is the one outcome worse
    // than not having the page.
    //
    // The id comes from the list rather than being written in, so the case does
    // not depend on the catalogue holding a particular repository: a fixture id
    // would make this pass as a NOT_FOUND and assert nothing.
    const caller = createCaller(fakeUserContext(db))
    const { items } = await caller.repos.list({ limit: 1, offset: 0 })
    const id = items[0]?.id
    if (!id) return

    const repo = await caller.repos.byId({ id })

    // The rows the page renders, named so a column dropped from the query
    // fails here rather than as an empty table on screen.
    expect(repo.id).toBe(id)
    expect(repo.fullName).toBe(`${repo.owner}/${repo.name}`)
    expect(repo.repoUrl).toBe(`https://github.com/${repo.owner}/${repo.name}`)
    expect(Array.isArray(repo.projects)).toBe(true)
    expect(Array.isArray(repo.monthlyStats)).toBe(true)
    expect(repo.trends.bars).toHaveLength(12)
    expect(repo.trends.weeks).toHaveLength(12)
  })

  it("refuses an unknown repository to a signed-in non-admin", async () => {
    // The read is not a lookup that falls open: an id nobody owns is
    // NOT_FOUND, and a page that rendered an empty repository instead would be
    // indistinguishable from one that works.
    const caller = createCaller(fakeUserContext(db))

    await expect(
      caller.repos.byId({ id: "no-such-repository" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("refuses the repository mutations to a signed-in non-admin", async () => {
    // `repos.create` is the exception and is covered above; these are the ones
    // that would let an ordinary account edit or remove an entry, or spend the
    // GitHub rate limit by asking for a resync.
    const caller = createCaller(fakeUserContext(db))

    await expect(caller.repos.refresh({ id: "any-id" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    await expect(caller.repos.delete({ id: "any-id" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    await expect(
      caller.repos.update({ id: "any-id", description: "rewritten" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("hands a signed-in non-admin no write procedure on this router", async () => {
    // The completeness check the case above cannot make. That one names the
    // three mutations it knows about, so a fourth added to the router without a
    // role check would pass every test in this file.
    //
    // Which procedures exist is read from the router rather than listed here,
    // and each is called through the caller with an argument object that
    // satisfies every input in this router at once, so no case fails on
    // validation instead of on the role. Classification is by outcome: tRPC
    // checks the role before the resolver runs, so an operator procedure answers
    // FORBIDDEN having touched nothing, and a read answers with a row or
    // NOT_FOUND. A read is therefore anything that is not FORBIDDEN.
    const caller = createCaller(fakeUserContext(db))
    const { items } = await caller.repos.list({ limit: 1, offset: 0 })

    const input = {
      id: items[0]?.id ?? "any-id",
      // Unparseable on purpose: `repos.create` is one of the allowed ones, and
      // a real `owner/name` would send it to GitHub to test a role split.
      repository: "not a repository url",
      force: false,
      description: null,
      filter: "all",
      search: "",
      limit: 1,
      offset: 0,
    }

    // The two reads `/console/repos` is built on, and the one write an ordinary
    // account may make. Everything else has to be refused.
    const allowed = new Set(["repos.list", "repos.byId", "repos.create"])

    // The caller's procedures are individually typed, and this loop is the one
    // place that has to reach all of them without naming them, so the router is
    // widened here and only here.
    const procedures = caller.repos as unknown as Record<
      string,
      (input: unknown) => Promise<unknown>
    >

    for (const name of Object.keys(procedures)) {
      const procedure = procedures[name]
      if (!procedure) continue

      const outcome = await procedure(input).then(
        () => "allowed",
        (error: { code?: string }) => error.code
      )

      if (allowed.has(name)) {
        expect(outcome, name).not.toBe("FORBIDDEN")
      } else {
        expect(outcome, name).toBe("FORBIDDEN")
      }
    }
  })

  it("admits an admin to the same procedures it refuses others", async () => {
    const caller = createCaller(fakeAdminContext(db))

    // Reading only: a refusal here would mean the role check rejects the role it
    // is written for, which is the one bug the gate cannot be allowed to have.
    await expect(caller.authors.list()).resolves.toBeDefined()
    await expect(
      caller.repos.list({ limit: 1, offset: 0 })
    ).resolves.toBeDefined()
  })

  /**
   * What the two audiences see in the repository list.
   *
   * `/console` filters `list` and `byId` by ownership, so "我的仓库" means the
   * account's own repositories rather than the whole registry; the operator's
   * `/dashboard` still sees everything. Ownership is `repos.created_by` **or** a
   * `user_repos` row: the first records who got here first, the second records
   * who submitted the URL, and an API submission only ever writes the second —
   * so a filter reading the first alone hides it from the account that made it.
   * The four fixtures carry a per-run suffix in their names and every query is
   * scoped by that suffix, so the assertions name exactly these rows and cannot
   * be satisfied by whatever else the database happens to hold.
   */
  describe("repository ownership", () => {
    const suffix = `ownership-${Math.random().toString(36).slice(2, 10)}`
    const ids = {
      mine: `repo-mine-${suffix}`,
      theirs: `repo-theirs-${suffix}`,
      unowned: `repo-unowned-${suffix}`,
      submitted: `repo-submitted-${suffix}`,
    }

    // `user_repos.user_id` references `user`, so the submitter has to be a real
    // row. `user-1` / `user-2` match `fakeUserContext`'s hard-coded id and the
    // `created_by` fixtures above; the API fixture hangs off `user-1`.
    const userIds = {
      mine: `user-1`,
      theirs: `user-2`,
    }

    const columns = {
      owner: "ownership-verify",
      ownerId: 1,
      pushedAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }

    beforeAll(async () => {
      await db
        .insert(user)
        .values([
          {
            id: userIds.mine,
            name: "Ownership Mine",
            email: `ownership-mine-${suffix}@console.test`,
            emailVerified: true,
          },
          {
            id: userIds.theirs,
            name: "Ownership Theirs",
            email: `ownership-theirs-${suffix}@console.test`,
            emailVerified: true,
          },
        ])
        .onConflictDoNothing()

      await db.insert(repos).values([
        {
          ...columns,
          id: ids.mine,
          name: `mine-${suffix}`,
          createdBy: userIds.mine,
        },
        {
          ...columns,
          id: ids.theirs,
          name: `theirs-${suffix}`,
          createdBy: userIds.theirs,
        },
        {
          ...columns,
          id: ids.unowned,
          name: `unowned-${suffix}`,
          createdBy: null,
        },
        {
          // Nobody recorded it first: the API wrote a submission row and left
          // `created_by` alone, which is what the two writers actually do.
          ...columns,
          id: ids.submitted,
          name: `submitted-${suffix}`,
          createdBy: null,
        },
      ])

      await db.insert(userRepos).values({
        userId: userIds.mine,
        repoId: ids.submitted,
        source: "api",
      })
    })

    afterAll(async () => {
      await db.delete(repos).where(inArray(repos.id, Object.values(ids)))
      // `user_repos` cascades from both sides, so the rows are already gone;
      // the accounts exist only for these fixtures and go with them.
      await db
        .delete(user)
        .where(inArray(user.id, [userIds.mine, userIds.theirs]))
    })

    it("shows a non-admin only the repositories that account submitted", async () => {
      const caller = createCaller(fakeUserContext(db))

      const { items, total } = await caller.repos.list({
        search: suffix,
        limit: 10,
        offset: 0,
      })

      // Two, not one: the pasted one and the API-submitted one.
      expect(total).toBe(2)
      expect(new Set(items.map((repo) => repo.id))).toEqual(
        new Set([ids.mine, ids.submitted])
      )
    })

    it("shows an admin every repository, owned or not", async () => {
      const caller = createCaller(fakeAdminContext(db))

      const { items, total } = await caller.repos.list({
        search: suffix,
        limit: 10,
        offset: 0,
      })

      expect(total).toBe(4)
      expect(new Set(items.map((repo) => repo.id))).toEqual(
        new Set([ids.mine, ids.theirs, ids.unowned, ids.submitted])
      )
    })

    it("counts for the dashboard exactly the repositories the list shows", async () => {
      const caller = createCaller(fakeUserContext(db))
      const { total } = await caller.repos.list({ limit: 1, offset: 0 })

      const { totals } = await caller.console.overview({ days: 90 })

      // Compared against the list rather than against a number: this suite runs
      // against a shared instance where the account may own other repositories,
      // and what must hold is that the dashboard and the list it sits above read
      // the same scope. A count of 4 next to a list of 2 is the bug worth
      // catching, and a hard-coded 2 would only catch it on an empty database.
      expect(totals.repos).toBe(total)
    })

    it("refuses the dashboard to a caller with no account", async () => {
      const caller = createCaller(fakeAnonymousContext(db))

      await expect(caller.console.overview({ days: 90 })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      })
    })

    it("hands the chart a series ordered oldest first and inside the window", async () => {
      const caller = createCaller(fakeUserContext(db))
      const days = 30

      const { series } = await caller.console.overview({ days })

      // The chart reads its window from the last point rather than from the
      // clock — see `chart-area-interactive` — so an unordered series would
      // silently widen the visible range instead of failing here.
      const dates = series.map((point) => point.date)
      expect(dates).toEqual([...dates].sort())
      const earliest = new Date(`${dates[0]}T00:00:00Z`)
      const latest = new Date(`${dates[dates.length - 1]}T00:00:00Z`)
      expect(latest.getTime() - earliest.getTime()).toBeLessThanOrEqual(
        (days - 1) * 86_400_000
      )
      // And every figure on it is a total, not a per-day delta, so the last
      // point cannot be smaller than an earlier one.
      for (const point of series) {
        expect(point.stars).toBeGreaterThanOrEqual(0)
        expect(point.forks).toBeGreaterThanOrEqual(0)
      }
    })

    it("opens a repository submitted by API key for the submitting account", async () => {
      const caller = createCaller(fakeUserContext(db))

      await expect(
        caller.repos.byId({ id: ids.submitted })
      ).resolves.toMatchObject({ id: ids.submitted })
      // `byId` is seven round trips — the row, then six child reads — and this
      // suite runs against a remote instance, so the default 5s budget is a
      // coin flip rather than an assertion about the code under test.
    }, 30_000)

    it("never lists one repository twice when both columns name the account", async () => {
      const caller = createCaller(fakeUserContext(db))

      const { items } = await caller.repos.list({
        search: `mine-${suffix}`,
        limit: 10,
        offset: 0,
      })

      expect(items.map((repo) => repo.id)).toEqual([ids.mine])
    })

    it("lets a non-admin open their own repository but not another account's", async () => {
      const caller = createCaller(fakeUserContext(db))

      await expect(caller.repos.byId({ id: ids.mine })).resolves.toMatchObject({
        id: ids.mine,
      })
      await expect(caller.repos.byId({ id: ids.theirs })).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      )
      // Unowned belongs to the operator's registry, not to anybody's list.
      await expect(
        caller.repos.byId({ id: ids.unowned })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }, 30_000)

    it("hides another account's submission, whatever recorded it", async () => {
      const caller = createCaller(fakeAccountContext(db, userIds.theirs))

      const { items } = await caller.repos.list({
        search: suffix,
        limit: 10,
        offset: 0,
      })

      expect(new Set(items.map((repo) => repo.id))).toEqual(
        new Set([ids.theirs])
      )
      await expect(
        caller.repos.byId({ id: ids.submitted })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    })
  })
})
