/**
 * Integration tests for the Cron entrypoint.
 *
 * The property that matters is fail-closed: this route writes to the database
 * and triggers pushes, and an unauthenticated scheduler is a standing
 * invitation. So the tests below check the guard before anything else, and
 * check that a missing secret does not become an open trigger.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { taskDefinitions } from "@/db/schema"
import { eq } from "drizzle-orm"
import { resetSyncEnvCache } from "@/lib/env"
import { TASK_SEEDS } from "@/lib/tasks/definitions"
import { resetInstalledTasks } from "@/lib/tasks/registry"
import { listTaskDefinitions, setTaskEnabled } from "@/lib/github/service/task"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

type Route = typeof import("@/app/api/cron/github/route")
let route: Route

async function call(
  handler: (request: Request) => Promise<Response>,
  auth?: string
): Promise<Response> {
  return handler(
    new Request("https://console.test/api/cron/github", {
      headers: auth ? { authorization: auth } : {},
    })
  )
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe.skipIf(!hasDatabase)("cron endpoint (integration)", () => {
  const previous = {
    cron: process.env.CRON_SECRET,
    token: process.env.GITHUB_ACCESS_TOKEN,
  }

  beforeAll(async () => {
    process.env.GITHUB_ACCESS_TOKEN = "test-token"
    process.env.CRON_SECRET = "s3cret"
    resetSyncEnvCache()
    route = await import("@/app/api/cron/github/route")
  })

  afterAll(async () => {
    restore("CRON_SECRET", previous.cron)
    restore("GITHUB_ACCESS_TOKEN", previous.token)
    resetSyncEnvCache()
    resetInstalledTasks()
    await pool.end()
  })

  beforeEach(async () => {
    await db.delete(taskDefinitions)
  })

  describe("authentication", () => {
    it("returns 404 with no secret, rather than an open trigger", async () => {
      delete process.env.CRON_SECRET
      resetSyncEnvCache()

      const response = await call(route.GET)
      expect(response.status).toBe(404)
      // 404, not 401: a 401 confirms the route exists and is merely guarded.
      expect(await response.json()).toEqual({ error: "not found" })
      // And nothing ran.
      expect(await listTaskDefinitions(db)).toHaveLength(0)

      process.env.CRON_SECRET = "s3cret"
      resetSyncEnvCache()
    })

    it("rejects a request with no Authorization header", async () => {
      const response = await call(route.GET)
      expect(response.status).toBe(401)
      expect(await listTaskDefinitions(db)).toHaveLength(0)
    })

    it("rejects a wrong secret", async () => {
      const response = await call(route.GET, "Bearer wrong")
      expect(response.status).toBe(401)
      expect(await listTaskDefinitions(db)).toHaveLength(0)
    })

    it("rejects a token sent without the Bearer scheme", async () => {
      const response = await call(route.GET, "s3cret")
      expect(response.status).toBe(401)
    })

    it("rejects a prefix of the real secret", async () => {
      const response = await call(route.GET, "Bearer s3cre")
      expect(response.status).toBe(401)
    })

    it("accepts the real secret", async () => {
      const response = await call(route.GET, "Bearer s3cret")
      expect(response.status).toBe(200)
    })

    it("guards POST the same way as GET", async () => {
      expect((await call(route.POST, "Bearer wrong")).status).toBe(401)
      expect((await call(route.POST)).status).toBe(401)
      expect((await call(route.POST, "Bearer s3cret")).status).toBe(200)
    })
  })

  describe("seeding", () => {
    it("seeds every definition on the first tick", async () => {
      await call(route.GET, "Bearer s3cret")

      expect((await listTaskDefinitions(db)).map((d) => d.name).sort()).toEqual(
        TASK_SEEDS.map((seed) => seed.name).sort()
      )
    })

    it("is idempotent, so a second tick does not duplicate rows", async () => {
      await call(route.GET, "Bearer s3cret")
      await call(route.GET, "Bearer s3cret")

      expect(await listTaskDefinitions(db)).toHaveLength(TASK_SEEDS.length)
    })

    it("leaves an operator's schedule change alone", async () => {
      await call(route.GET, "Bearer s3cret")
      const [definition] = await listTaskDefinitions(db)
      await db
        .update(taskDefinitions)
        .set({ cronExpression: "0 5 * * *" })
        .where(eq(taskDefinitions.id, definition!.id))

      await call(route.GET, "Bearer s3cret")

      const after = await listTaskDefinitions(db)
      expect(
        after.find((d) => d.id === definition!.id)?.cronExpression
      ).toBe("0 5 * * *")
    })
  })

  describe("scheduling", () => {
    // 03:00 on 1 March in Asia/Shanghai is 19:00 UTC on 28 February, because
    // the zone is UTC+8 and has no daylight saving.
    const FIRST_OF_MARCH_0300_SHANGHAI = new Date("2026-02-28T19:00:00Z")

    it("runs only what is due at the given moment", async () => {
      const body = await (
        await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)
      ).json()

      expect(Object.keys(body.results)).toEqual(["build-monthly-rankings"])
      // The monthly build has no implementation in this migration, and saying
      // so is what distinguishes a known gap from a broken task.
      expect(body.results["build-monthly-rankings"]).toBe("unimplemented")
    })

    it("evaluates the schedule in Asia/Shanghai, not UTC", async () => {
      // This instant is 04:00 on 1 March in UTC, where `update-bundle-size`'s
      // "0 4 * * *" matches. In Shanghai it is 12:00, which nothing is
      // scheduled for, so a scheduler reading the expression in UTC would start
      // a bundle sweep eight hours early.
      const body = await (
        await route.runScheduledTasks(new Date("2026-03-01T04:00:00Z"))
      ).json()

      expect(body.results).toEqual({})
    })

    it("runs nothing when nothing is due", async () => {
      // 03:00 on the 2nd in Shanghai: the monthly task matched the 1st.
      const body = await (
        await route.runScheduledTasks(new Date("2026-03-01T19:00:00Z"))
      ).json()

      expect(body.results).toEqual({})
    })

    it("skips a task an operator has disabled", async () => {
      await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)

      const definition = (await listTaskDefinitions(db)).find(
        (candidate) => candidate.name === "build-monthly-rankings"
      )
      await setTaskEnabled(db, definition!.id, false)

      const body = await (
        await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)
      ).json()

      // A disabled task is not "due" work: the run summary says nothing ran.
      expect(body.results).toEqual({})
    })

    it("does not let the same-minute guard hide a known gap", async () => {
      // The monthly task never runs, so it leaves no execution row. If the
      // guard were consulted first it would still report "already ran this
      // minute" on the second tick and a known gap would read as done work.
      await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)
      const body = await (
        await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)
      ).json()

      expect(body.results["build-monthly-rankings"]).toBe("unimplemented")
    })

    it("keeps the disabled flag across later ticks", async () => {
      // The seed runs on every tick. Going through an upsert would restore the
      // shipped `isEnabled` a moment after anyone turned a task off.
      await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)
      const definition = (await listTaskDefinitions(db)).find(
        (candidate) => candidate.name === "build-monthly-rankings"
      )
      await setTaskEnabled(db, definition!.id, false)

      await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)
      await route.runScheduledTasks(FIRST_OF_MARCH_0300_SHANGHAI)

      const after = (await listTaskDefinitions(db)).find(
        (candidate) => candidate.name === "build-monthly-rankings"
      )
      expect(after?.isEnabled).toBe(false)
    })

    it("reports the recovered-run count", async () => {
      const body = await (await route.runScheduledTasks()).json()
      expect(typeof body.recovered).toBe("number")
    })

    it("lists the registered implementations", async () => {
      const body = await (await route.runScheduledTasks()).json()
      expect(body.registered).toContain("update-package-data")
    })
  })
})
