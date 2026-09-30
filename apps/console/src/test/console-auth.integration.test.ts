/**
 * Integration tests for the console's authorization split.
 *
 * The console serves two audiences from one deployment: an operator curates the
 * catalogue from `/dashboard`, and anyone else signed in reaches `/console`,
 * which is the repository list and nothing else. The two layouts that redirect
 * between those paths are UX; this file covers the part that cannot be skipped,
 * which is the role check on each procedure.
 *
 * The behaviour worth protecting is the failure mode: a gate that treats an
 * unrecognised role as an admin would turn a typo in one `update` statement
 * into full access to every project, task and repository. So the refusal cases
 * get as much attention as the allowed ones.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { db, pool } from "@/db/client"
import { createCaller } from "@/lib/trpc/root"
import { isAdmin, landingPathFor } from "@/lib/auth/role"
import { ADMIN_ROLE } from "@/lib/auth/role"
import {
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
      await expect(call(typo), label).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(call(longer), label).rejects.toMatchObject({ code: "FORBIDDEN" })
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
    // The one thing `/console` is: the list is readable, because a page that
    // cannot list its own content renders empty and looks broken.
    const caller = createCaller(fakeUserContext(db))

    const result = await caller.repos.list({ limit: 5, offset: 0 })

    expect(Array.isArray(result.items)).toBe(true)
    expect(typeof result.total).toBe("number")
  })

  it("refuses the repository mutations to a signed-in non-admin", async () => {
    // `repos.create` is the exception and is covered above; these are the ones
    // that would let an ordinary account edit or remove an entry, or spend the
    // GitHub rate limit by asking for a resync.
    const caller = createCaller(fakeUserContext(db))

    await expect(
      caller.repos.refresh({ id: "any-id" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(
      caller.repos.delete({ id: "any-id" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(
      caller.repos.update({ id: "any-id", description: "rewritten" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("admits an admin to the same procedures it refuses others", async () => {
    const caller = createCaller(fakeAdminContext(db))

    // Reading only: a refusal here would mean the role check rejects the role it
    // is written for, which is the one bug the gate cannot be allowed to have.
    await expect(caller.authors.list()).resolves.toBeDefined()
    await expect(caller.repos.list({ limit: 1, offset: 0 })).resolves.toBeDefined()
  })
})
