/**
 * Integration tests for `GET /api/skills-sync/export`.
 *
 * The route publishes every stored skill, so the guard is checked first: an
 * export with no credential hands the whole skill corpus to anyone who asks.
 * The guard is api-key based — `skills:read` in `api_keys` — so what only a
 * real database can show is the part a fake `lookup` in `api-guard.test.ts`
 * cannot: a key issued here really does open the route, and a key issued
 * without the scope really does not.
 */

import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { projectSkills, projects, projectSyncJobs, repos } from "@/db/schema"
import { apiKeys } from "@/db/schema/api-keys"
import { hashApiKey, issueApiKey } from "@/lib/api/keys"
import { createProject } from "@/lib/github/service/project"
import { upsertRepo } from "@/lib/github/service/repo"
import { syncProjectSkills } from "@/lib/github/service/skill"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

let exporter: typeof import("@/app/api/skills-sync/export/route")

/** The row a plaintext resolved to, so a test's own key can be cleaned up. */
async function idOf(secret: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashApiKey(secret)))
  return row?.id
}

function get(query: string, auth?: string): Promise<Response> {
  return exporter.GET(
    new Request(`https://console.test/api/skills-sync/export${query}`, {
      headers: auth ? { authorization: auth } : {},
    })
  )
}

describe.skipIf(!hasDatabase)(
  "GET /api/skills-sync/export (integration)",
  () => {
    let reader: string
    let wrongScope: string
    const issuedIds: string[] = []

    beforeAll(async () => {
      exporter = await import("@/app/api/skills-sync/export/route")
      reader = (
        await issueApiKey(db, {
          name: "skills-export reader",
          scopes: ["skills:read"],
          createdBy: null,
        })
      ).secret
      wrongScope = (
        await issueApiKey(db, {
          name: "skills-export without the scope",
          scopes: ["repos:read"],
          createdBy: null,
        })
      ).secret
      // The plaintexts above are the only copies; the rows are named by the
      // hash of each, which is what cleanup deletes by.
      issuedIds.push((await idOf(reader))!, (await idOf(wrongScope))!)
    })

    afterAll(async () => {
      for (const id of issuedIds) {
        await db.delete(apiKeys).where(eq(apiKeys.id, id))
      }
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

      it("publishes nothing without a credential", async () => {
        await seedSkill("alpha", "skills/alpha")

        // 401 for "you sent no key", 404 for "we have never issued that one":
        // the second must not confirm which of the two the caller got wrong.
        expect((await get("")).status).toBe(401)
        expect((await get("", "Bearer mcp_radar_zzzz_nope")).status).toBe(404)

        const response = await get("")
        expect((await response.json()).skills).toBeUndefined()
      })

      it("refuses a key that does not carry skills:read", async () => {
        expect((await get("", `Bearer ${wrongScope}`)).status).toBe(403)
      })

      it("returns the webhook payload for an unsynced skill", async () => {
        const { repo } = await seedSkill("alpha", "skills/alpha")

        const response = await get("", `Bearer ${reader}`)

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
          await get("?limit=2", `Bearer ${reader}`)
        ).json()
        expect(first.skills).toHaveLength(2)
        expect(first.next_cursor).toBeNull()

        // A cursor is only handed out when a further row exists, so a walk
        // stops rather than re-fetching the same page forever.
        const empty = await (
          await get("?limit=3", `Bearer ${reader}`)
        ).json()
        expect(empty.skills).toHaveLength(3)
        expect(empty.next_cursor).toBeNull()
      })

      it("rejects an unusable limit or cursor", async () => {
        expect((await get("?limit=0", `Bearer ${reader}`)).status).toBe(400)
        expect((await get("?limit=abc", `Bearer ${reader}`)).status).toBe(
          400
        )
        expect((await get("?limit=99999", `Bearer ${reader}`)).status).toBe(
          400
        )
        expect((await get("?cursor=soon", `Bearer ${reader}`)).status).toBe(
          400
        )
      })
    })
  }
)
