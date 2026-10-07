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
import { getTaskRegistry } from "@/lib/tasks/runner"
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
      expect(after.find((d) => d.id === definition!.id)?.cronExpression).toBe(
        "0 5 * * *"
      )
    })
  })

  describe("scheduling", () => {
    // 02:00 on 1 March in Asia/Shanghai is 18:00 UTC on 28 February, because
    // the zone is UTC+8 and has no daylight saving. That is the daily wake-up,
    // and the moment every test below drives the cascade from.
    const WAKE_UP = new Date("2026-02-28T18:00:00Z")

    /** Turns off every task except the named ones, to keep a test to one run. */
    async function onlyEnable(...names: string[]) {
      for (const definition of await listTaskDefinitions(db)) {
        await setTaskEnabled(db, definition.id, names.includes(definition.name))
      }
    }

    it("runs the missed period first, then the current one, then stops", async () => {
      // The monthly build is due at 03:00 on the 1st. At the 02:00 wake-up on
      // 1 March the 03:00 slot has not arrived, so the period on offer is
      // February — the report nobody ran — and March waits for the next
      // wake-up. A fresh database is the extreme of a missed period: everything
      // is outstanding, which is why a new deployment backfills rather than
      // waiting for the next 1st.
      await route.runScheduledTasks(WAKE_UP)
      await onlyEnable("build-monthly-rankings")

      const first = await (await route.runScheduledTasks(WAKE_UP)).json()
      expect(first.results["build-monthly-rankings"]).toBe("completed")
      expect(first.periods["build-monthly-rankings"]).toBe("2026-02")

      const second = await (await route.runScheduledTasks(WAKE_UP)).json()
      expect(second.results["build-monthly-rankings"]).toBe("completed")
      expect(second.periods["build-monthly-rankings"]).toBe("2026-03")

      // Both periods are done, so the third tick is a no-op rather than a third
      // rebuild of the same month.
      const third = await (await route.runScheduledTasks(WAKE_UP)).json()
      expect(third.results["build-monthly-rankings"]).toBe(
        "already ran this period"
      )
    })

    it("does not run a period whose slot has not arrived yet", async () => {
      // `update-bundle-size` is due at 04:00. At the 02:00 wake-up today's
      // period has not reached 04:00, so the run belongs to the day that was
      // due — running today's build at 02:00 would measure bundles before the
      // package refresh that feeds them has run.
      await route.runScheduledTasks(WAKE_UP)
      await onlyEnable("update-bundle-size")

      const body = await (await route.runScheduledTasks(WAKE_UP)).json()
      expect(body.results["update-bundle-size"]).toBe("completed")
      expect(body.periods["update-bundle-size"]).toBe("2026-02-28")
    })

    it("evaluates the schedule in Asia/Shanghai, not UTC", async () => {
      // 20:00 UTC on 28 February is 04:00 on 1 March in Shanghai. A scheduler
      // reading the clock in UTC would put the 04:00 bundle sweep on the 28th,
      // three days before the monthly rankings it feeds.
      await route.runScheduledTasks(WAKE_UP)
      await onlyEnable("update-bundle-size")

      const body = await (
        await route.runScheduledTasks(new Date("2026-02-28T20:00:00Z"))
      ).json()

      expect(body.periods["update-bundle-size"]).toBe("2026-03-01")
    })

    it("skips a task an operator has disabled", async () => {
      await route.runScheduledTasks(WAKE_UP)
      const definition = (await listTaskDefinitions(db)).find(
        (candidate) => candidate.name === "build-monthly-rankings"
      )
      await setTaskEnabled(db, definition!.id, false)

      const body = await (await route.runScheduledTasks(WAKE_UP)).json()

      // A disabled task is not "due" work: the run summary says nothing ran.
      expect(body.results).toEqual({})
    })

    it("retries a failed period, then gives up on it", async () => {
      // A failure is retried rather than read as done work — otherwise a
      // misconfiguration would hide for a month — and it is retried a bounded
      // number of times, so one broken task cannot spend every wake-up
      // re-discovering that it is still broken.
      //
      // No seeded task fails deterministically now that the ranking digest
      // tasks are gone, and every remaining candidate reaches the network, so
      // the run under test is a registered test double rather than a
      // production task that happens to be misconfigured.
      await route.runScheduledTasks(WAKE_UP)
      const registry = getTaskRegistry()
      const genuine = registry.get("build-daily-data")!
      registry.set("build-daily-data", {
        name: "build-daily-data",
        description: "Always fails; test double for the retry rule",
        async run() {
          throw new Error("test double failure")
        },
      })

      try {
        await onlyEnable("build-daily-data")

        for (const attempt of [1, 2, 3]) {
          const body = await (await route.runScheduledTasks(WAKE_UP)).json()
          expect(body.results["build-daily-data"], `attempt ${attempt}`).toBe(
            "failed"
          )
        }

        const givenUp = await (await route.runScheduledTasks(WAKE_UP)).json()
        expect(givenUp.results["build-daily-data"]).toBe(
          "gave up after 3 attempts"
        )
      } finally {
        registry.set("build-daily-data", genuine)
      }
    })

    it("keeps the disabled flag across later ticks", async () => {
      // The seed runs on every tick. Going through an upsert would restore the
      // shipped `isEnabled` a moment after anyone turned a task off.
      await route.runScheduledTasks(WAKE_UP)
      const definition = (await listTaskDefinitions(db)).find(
        (candidate) => candidate.name === "build-monthly-rankings"
      )
      await setTaskEnabled(db, definition!.id, false)

      await route.runScheduledTasks(WAKE_UP)
      await route.runScheduledTasks(WAKE_UP)

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
