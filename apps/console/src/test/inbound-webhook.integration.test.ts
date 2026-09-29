/**
 * Integration tests for the inbound trigger webhook.
 *
 * The property that matters is the same one the Cron entrypoint guards: this
 * endpoint writes to the database and runs tasks, so an unauthenticated call
 * is a standing invitation to trigger work on demand. The auth tests come
 * first, and a missing secret does not become an open trigger. Beyond that,
 * the tests pin which task names resolve, how a disabled task reads, and that
 * the same-minute guard applies to a webhook run like any other.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { taskDefinitions, taskExecutions } from "@/db/schema"
import { resetSyncEnvCache } from "@/lib/env"
import {
  getTaskDefinitionByName,
  setTaskEnabled,
} from "@/lib/github/service/task"
import { resetInstalledTasks, UNIMPLEMENTED_TASKS } from "@/lib/tasks/registry"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

type Route = typeof import("@/app/api/webhook/[task]/route")
let route: Route

function call(task: string, auth?: string): Promise<Response> {
  return route.POST(
    new Request(`https://console.test/api/webhook/${task}`, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }),
    { params: Promise.resolve({ task }) }
  )
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe.skipIf(!hasDatabase)("inbound trigger webhook (integration)", () => {
  const previous = {
    cron: process.env.CRON_SECRET,
    token: process.env.GITHUB_ACCESS_TOKEN,
  }

  beforeAll(async () => {
    // Installing the registry constructs the GitHub-backed tasks, which need a
    // token even though this endpoint only runs the rankings build.
    process.env.GITHUB_ACCESS_TOKEN = "test-token"
    process.env.CRON_SECRET = "s3cret"
    resetSyncEnvCache()
    route = await import("@/app/api/webhook/[task]/route")
  })

  afterAll(async () => {
    restore("CRON_SECRET", previous.cron)
    restore("GITHUB_ACCESS_TOKEN", previous.token)
    resetSyncEnvCache()
    resetInstalledTasks()
    await pool.end()
  })

  beforeEach(async () => {
    process.env.CRON_SECRET = "s3cret"
    resetSyncEnvCache()
    resetInstalledTasks()
    // The shared database may already hold seed rows from another test file.
    // Executions clear first, so their rows cannot block deleting definitions.
    await db.delete(taskExecutions)
    await db.delete(taskDefinitions)
  })

  describe("authentication", () => {
    it("returns 404 with no secret, rather than an open trigger", async () => {
      delete process.env.CRON_SECRET
      resetSyncEnvCache()

      const response = await call("build-weekly-rankings")
      expect(response.status).toBe(404)
      // 404, not 401: a 401 confirms the route exists and is merely guarded.
      expect(await response.json()).toEqual({ error: "not found" })
      // And nothing was seeded or run.
      expect(
        await getTaskDefinitionByName(db, "build-weekly-rankings")
      ).toBeUndefined()

      process.env.CRON_SECRET = "s3cret"
      resetSyncEnvCache()
    })

    it("rejects a request with no Authorization header", async () => {
      const response = await call("build-weekly-rankings")
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "unauthorized" })
    })

    it("rejects a wrong secret", async () => {
      const response = await call("build-weekly-rankings", "Bearer wrong")
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "unauthorized" })
    })
  })

  describe("triggering", () => {
    it("reports an unknown task", async () => {
      const response = await call("no-such-task", "Bearer s3cret")
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({
        error: "unknown task: no-such-task",
      })
    })

    it("reports a seeded task with no implementation", async () => {
      UNIMPLEMENTED_TASKS.add("build-weekly-rankings")
      try {
        const response = await call("build-weekly-rankings", "Bearer s3cret")
        expect(response.status).toBe(501)
        expect(await response.json()).toEqual({
          task: "build-weekly-rankings",
          status: "unimplemented",
        })
      } finally {
        UNIMPLEMENTED_TASKS.delete("build-weekly-rankings")
      }
    })

    it("refuses a disabled task", async () => {
      const response = await call("build-weekly-rankings", "Bearer s3cret")
      expect(response.status).toBe(200)

      const definition = await getTaskDefinitionByName(
        db,
        "build-weekly-rankings"
      )
      expect(definition).toBeDefined()
      await setTaskEnabled(db, definition!.id, false)

      const disabled = await call("build-weekly-rankings", "Bearer s3cret")
      expect(disabled.status).toBe(409)
      expect(await disabled.json()).toEqual({
        task: "build-weekly-rankings",
        status: "skipped",
        reason: "task is disabled",
      })
    })

    it("runs the named task and reports the outcome", async () => {
      const response = await call("build-weekly-rankings", "Bearer s3cret")

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        task: string
        status: string
        result: Record<string, unknown>
      }
      expect(body.task).toBe("build-weekly-rankings")
      expect(body.status).toBe("completed")
      // The weekly build has nothing to rank against an empty database, so it
      // reports its "keep the previous file" decision instead of failing.
      expect(body.result).toMatchObject({
        period: "week",
        published: false,
        trending: 0,
      })
    })

    it("skips a second run in the same minute", async () => {
      const first = await call("build-weekly-rankings", "Bearer s3cret")
      expect(first.status).toBe(200)

      const second = await call("build-weekly-rankings", "Bearer s3cret")
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({
        task: "build-weekly-rankings",
        status: "skipped",
        reason: "already ran this minute",
      })
    })
  })
})
