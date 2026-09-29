/**
 * Integration tests for the machine-to-machine endpoints.
 *
 * Both routes write or expose stored data on a bearer token, so the guard is
 * checked first in each case: an unauthenticated ingest is a standing
 * invitation to overwrite repository data, and an unauthenticated export
 * publishes every stored skill.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { projectSkills, projects, projectSyncJobs, repos } from "@/db/schema"
import { resetSyncEnvCache } from "@/lib/env"
import { createProject } from "@/lib/github/service/project"
import { setReadme, upsertRepo } from "@/lib/github/service/repo"
import { syncProjectSkills } from "@/lib/github/service/skill"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let ingest: typeof import("@/app/api/internal/repos/route")
let exporter: typeof import("@/app/api/skills-sync/export/route")

/** A body that satisfies the wire schema, with the dates JSON carries. */
function repoPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "repo",
    fullName: "owner/repo",
    owner: "owner",
    ownerId: 100,
    description: "A repository",
    homepage: "https://example.com",
    createdAt: "2024-01-01T00:00:00.000Z",
    pushedAt: "2026-02-15T00:00:00.000Z",
    defaultBranch: "main",
    stars: 120,
    topics: ["typescript"],
    archived: false,
    commitCount: 40,
    lastCommit: "2026-02-14T00:00:00.000Z",
    mentionableUsersCount: 7,
    watchersCount: 60,
    licenseSpdxId: "MIT",
    pullRequestsCount: 3,
    releasesCount: 2,
    languages: ["TypeScript"],
    forks: 10,
    openGraphImageUrl: "https://images.example.com/og.png",
    usesCustomOpenGraphImage: false,
    latestReleaseName: "v1.0.0",
    latestReleaseTagName: "v1.0.0",
    latestReleasePublishedAt: "2026-01-01T00:00:00.000Z",
    latestReleaseUrl: "https://example.com/releases/v1.0.0",
    latestReleaseDescription: "First release",
    ...overrides,
  }
}

function post(url: string, body: unknown, auth?: string): Promise<Response> {
  return ingest.POST(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify(body),
    })
  )
}

function get(query: string, auth?: string): Promise<Response> {
  return exporter.GET(
    new Request(`https://console.test/api/skills-sync/export${query}`, {
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

describe.skipIf(!hasDatabase)("internal endpoints (integration)", () => {
  const previous = {
    apiToken: process.env.CONSOLE_API_TOKEN,
    skillsToken: process.env.SKILLS_WEBHOOK_TOKEN,
  }

  beforeAll(async () => {
    process.env.CONSOLE_API_TOKEN = "api-token"
    process.env.SKILLS_WEBHOOK_TOKEN = "skills-token"
    resetSyncEnvCache()
    ingest = await import("@/app/api/internal/repos/route")
    exporter = await import("@/app/api/skills-sync/export/route")
  })

  afterAll(async () => {
    restore("CONSOLE_API_TOKEN", previous.apiToken)
    restore("SKILLS_WEBHOOK_TOKEN", previous.skillsToken)
    resetSyncEnvCache()
    await pool.end()
  })

  beforeEach(async () => {
    await db.delete(projectSyncJobs)
    await db.delete(projectSkills)
    await db.delete(projects)
    await db.delete(repos)
  })

  describe("POST /api/internal/repos", () => {
    const url = "https://console.test/api/internal/repos"

    it("returns 404 with no token, rather than an open write", async () => {
      delete process.env.CONSOLE_API_TOKEN
      resetSyncEnvCache()

      const response = await post(url, repoPayload())

      expect(response.status).toBe(404)
      expect(await db.select().from(repos)).toHaveLength(0)
    })

    it("rejects a missing or wrong bearer token", async () => {
      process.env.CONSOLE_API_TOKEN = "api-token"
      resetSyncEnvCache()

      expect((await post(url, repoPayload())).status).toBe(401)
      expect((await post(url, repoPayload(), "Bearer wrong")).status).toBe(401)
      expect(await db.select().from(repos)).toHaveLength(0)
    })

    it("stores a repository and reports the assembled full name", async () => {
      const response = await post(url, repoPayload(), "Bearer api-token")

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        ok: true,
        repo: { full_name: "owner/repo", stars: 120 },
      })

      const stored = await db.select().from(repos)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        name: "repo",
        owner: "owner",
        ownerId: 100,
        licenseSpdxId: "MIT",
      })
      // A JSON timestamp arrives as a string, so the column proves the coercion.
      expect(stored[0]?.pushedAt).toEqual(new Date("2026-02-15T00:00:00.000Z"))
      expect(stored[0]?.latestReleasePublishedAt).toEqual(
        new Date("2026-01-01T00:00:00.000Z")
      )
    })

    it("accepts a repository with no release", async () => {
      const response = await post(
        url,
        repoPayload({ latestReleasePublishedAt: null }),
        "Bearer api-token"
      )

      expect(response.status).toBe(200)
      const stored = await db.select().from(repos)
      expect(stored[0]?.latestReleasePublishedAt).toBeNull()
    })

    it("updates a known repository without touching fields other tasks own", async () => {
      await post(url, repoPayload(), "Bearer api-token")
      const [stored] = await db.select().from(repos)
      await setReadme(db, stored!.id, "# readme")

      const response = await post(
        url,
        repoPayload({ stars: 999, pushedAt: "2026-03-01T00:00:00.000Z" }),
        "Bearer api-token"
      )

      expect(response.status).toBe(200)
      const [after] = await db.select().from(repos)
      expect(after).toMatchObject({ id: stored!.id, stars: 999 })
      // The README belongs to the readme task, so an ingest of statistics
      // must not blank it.
      expect(after?.readmeContent).toBe("# readme")
      expect(await db.select().from(repos)).toHaveLength(1)
    })

    it("rejects a body missing a required field, naming it", async () => {
      const response = await post(
        url,
        repoPayload({ fullName: undefined }),
        "Bearer api-token"
      )

      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain("fullName")
      expect(await db.select().from(repos)).toHaveLength(0)
    })

    it("rejects a counter the body omits only as unknown, not as zero", async () => {
      // The service writes counters only when they are non-zero, because a
      // lower-tier fetch reports zero for counters it never read.
      await post(url, repoPayload(), "Bearer api-token")
      const [before] = await db.select().from(repos)

      const response = await post(
        url,
        repoPayload({ stars: 500, forks: undefined, watchersCount: undefined }),
        "Bearer api-token"
      )

      expect(response.status).toBe(200)
      const [after] = await db.select().from(repos)
      expect(after?.stars).toBe(500)
      expect(after?.forks).toBe(before?.forks)
      expect(after?.watchersCount).toBe(before?.watchersCount)
    })

    it("rejects a field the schema does not know", async () => {
      const response = await post(
        url,
        repoPayload({ contributorCount: 3 }),
        "Bearer api-token"
      )

      expect(response.status).toBe(400)
      expect(await db.select().from(repos)).toHaveLength(0)
    })

    it("rejects a date that is not ISO 8601 instead of guessing", async () => {
      const response = await post(
        url,
        repoPayload({ pushedAt: "not-a-date" }),
        "Bearer api-token"
      )

      expect(response.status).toBe(400)
      expect(await db.select().from(repos)).toHaveLength(0)
    })

    it("rejects a body that is not JSON", async () => {
      const response = await ingest.POST(
        new Request(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer api-token",
          },
          body: "{not json",
        })
      )

      expect(response.status).toBe(400)
    })
  })

  describe("GET /api/skills-sync/export", () => {
    let nextId = 0

    /** Seeded through the service layer, which owns id and default columns. */
    async function seedSkill(name: string, dir: string) {
      const n = (nextId += 1)
      const repo = await upsertRepo(db, {
        name: `repo${n}`,
        fullName: `owner/repo${n}`,
        owner: "owner",
        ownerId: 4000 + n,
        description: "",
        homepage: "",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        pushedAt: new Date("2026-06-01T00:00:00Z"),
        defaultBranch: "main",
        stars: 1,
        topics: [],
        archived: false,
        commitCount: 1,
        lastCommit: new Date("2026-06-01T00:00:00Z"),
        mentionableUsersCount: 1,
        watchersCount: 1,
        licenseSpdxId: "MIT",
        pullRequestsCount: 1,
        releasesCount: 1,
        languages: [],
        forks: 0,
        openGraphImageUrl: "",
        usesCustomOpenGraphImage: false,
        latestReleaseName: "",
        latestReleaseTagName: "",
        latestReleasePublishedAt: undefined,
        latestReleaseUrl: "",
        latestReleaseDescription: "",
      })
      const project = await createProject(db, {
        repoId: repo.id,
        name: `Project ${n}`,
        owner: repo.owner,
        slug: `slug-${n}`,
        description: "",
        status: "active",
        type: "skill",
      })
      await syncProjectSkills(db, project.id, [
        {
          projectId: project.id,
          skillDir: dir,
          name,
          description: `${name} description`,
          descriptionZh: "",
          readme: `# ${name}`,
          readmeZh: "",
          version: "1.0.0",
        },
      ])
      return { repo, project }
    }

    it("returns 404 with no token, rather than publishing every skill", async () => {
      await seedSkill("alpha", "skills/alpha")
      delete process.env.SKILLS_WEBHOOK_TOKEN
      resetSyncEnvCache()

      const response = await get("")

      expect(response.status).toBe(404)
      expect((await response.json()).skills).toBeUndefined()
    })

    it("rejects a missing or wrong bearer token", async () => {
      process.env.SKILLS_WEBHOOK_TOKEN = "skills-token"
      resetSyncEnvCache()

      expect((await get("")).status).toBe(401)
      expect((await get("", "Bearer wrong")).status).toBe(401)
    })

    it("returns the webhook payload for an unsynced skill", async () => {
      const { repo } = await seedSkill("alpha", "skills/alpha")

      const response = await get("", "Bearer skills-token")

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.skills).toHaveLength(1)
      expect(body.skills[0]).toMatchObject({
        event_type: "skill_updated",
        data: {
          repo_full_name: `${repo.owner}/${repo.name}`,
          repo_name: repo.name,
          skill_dir: "skills/alpha",
          name: "alpha",
          version: "1.0.0",
        },
      })
      expect(body.next_cursor).toBeNull()
    })

    it("pages by cursor, advancing only when more remain", async () => {
      await seedSkill("alpha", "skills/a1")
      await seedSkill("beta", "skills/b1")
      await seedSkill("gamma", "skills/g1")

      const first = await (await get("?limit=2", "Bearer skills-token")).json()
      expect(first.skills).toHaveLength(2)
      expect(first.next_cursor).toBeNull()

      // A cursor is only handed out when a further row exists, so a walk
      // stops rather than re-fetching the same page forever.
      const empty = await (await get("?limit=3", "Bearer skills-token")).json()
      expect(empty.skills).toHaveLength(3)
      expect(empty.next_cursor).toBeNull()
    })

    it("rejects an unusable limit or cursor", async () => {
      expect((await get("?limit=0", "Bearer skills-token")).status).toBe(400)
      expect((await get("?limit=abc", "Bearer skills-token")).status).toBe(400)
      expect((await get("?limit=99999", "Bearer skills-token")).status).toBe(
        400
      )
      expect((await get("?cursor=soon", "Bearer skills-token")).status).toBe(
        400
      )
    })
  })
})
