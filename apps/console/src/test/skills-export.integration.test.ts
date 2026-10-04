/**
 * Integration tests for `GET /api/skills-sync/export`.
 *
 * The route publishes every stored skill on a bearer token, so the guard is
 * checked first: an unauthenticated export hands the whole skill corpus to
 * anyone who asks.
 *
 * The ingest side of the old machine-to-machine surface now lives in
 * `api-v1-repos.integration.test.ts` and `api-v1-projects.integration.test.ts`,
 * keyed on `api_keys` rather than on `CONSOLE_API_TOKEN`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { projectSkills, projects, projectSyncJobs, repos } from "@/db/schema"
import { resetSyncEnvCache } from "@/lib/env"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { syncProjectSkills } from "@/lib/github/service/skill"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let exporter: typeof import("@/app/api/skills-sync/export/route")

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

describe.skipIf(!hasDatabase)(
  "GET /api/skills-sync/export (integration)",
  () => {
    const previous = process.env.SKILLS_WEBHOOK_TOKEN

    beforeAll(async () => {
      process.env.SKILLS_WEBHOOK_TOKEN = "skills-token"
      resetSyncEnvCache()
      exporter = await import("@/app/api/skills-sync/export/route")
    })

    afterAll(async () => {
      restore("SKILLS_WEBHOOK_TOKEN", previous)
      resetSyncEnvCache()
      await pool.end()
    })

    beforeEach(async () => {
      await db.delete(projectSyncJobs)
      await db.delete(projectSkills)
      await db.delete(projects)
      await db.delete(repos)
    })

    describe("export", () => {
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
          openIssuesCount: 1,
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

        const first = await (
          await get("?limit=2", "Bearer skills-token")
        ).json()
        expect(first.skills).toHaveLength(2)
        expect(first.next_cursor).toBeNull()

        // A cursor is only handed out when a further row exists, so a walk
        // stops rather than re-fetching the same page forever.
        const empty = await (
          await get("?limit=3", "Bearer skills-token")
        ).json()
        expect(empty.skills).toHaveLength(3)
        expect(empty.next_cursor).toBeNull()
      })

      it("rejects an unusable limit or cursor", async () => {
        expect((await get("?limit=0", "Bearer skills-token")).status).toBe(400)
        expect((await get("?limit=abc", "Bearer skills-token")).status).toBe(
          400
        )
        expect((await get("?limit=99999", "Bearer skills-token")).status).toBe(
          400
        )
        expect((await get("?cursor=soon", "Bearer skills-token")).status).toBe(
          400
        )
      })
    })
  }
)
