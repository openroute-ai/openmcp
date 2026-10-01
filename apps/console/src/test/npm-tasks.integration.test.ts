/**
 * Integration tests for the npm-side tasks.
 *
 * The behaviour under test is what the source got wrong, and both mistakes are
 * silent: a download count that is never re-read still looks like a number,
 * and a package that is retried forever still produces a result. Neither
 * throws, so neither shows up without asking the question directly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { db, pool } from "@/db/client"
import { bundles, packages, projects, repos } from "@/db/schema"
import type { NpmClient } from "@/lib/npm/client"
import { getBundle, getPackage } from "@/lib/github/service/package"
import { upsertPackage } from "@/lib/github/service/package"
import { upsertRepo } from "@/lib/github/service/repo"
import { createUpdateBundleSizeTask } from "@/lib/tasks/tasks/update-bundle-size"
import { createUpdatePackageDataTask } from "@/lib/tasks/tasks/update-package-data"
import { fakeContext, fakeNpmClient } from "./helpers/fakes"

const hasDatabase = Boolean(process.env.CONSOLE_DATABASE_URL)

function repoInfo(owner: string, name: string) {
  return {
    name,
    fullName: `${owner}/${name}`,
    owner,
    ownerId: 7,
    description: "",
    homepage: "",
    createdAt: new Date("2020-01-01T00:00:00Z"),
    pushedAt: new Date("2026-01-01T00:00:00Z"),
    defaultBranch: "main",
    stars: 0,
    topics: [],
    archived: false,
    commitCount: 0,
    lastCommit: new Date(0),
    mentionableUsersCount: 0,
    watchersCount: 0,
    licenseSpdxId: "",
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

async function seedProject(
  slug: string,
  status: "active" | "deprecated" = "active"
): Promise<string> {
  const repo = await upsertRepo(db, repoInfo("npm", slug))
  const [row] = await db
    .insert(projects)
    .values({
      id: `project-${slug}`,
      name: slug,
      owner: "npm",
      slug,
      description: slug,
      status,
      repoId: repo.id,
    })
    .returning()
  return row!.id
}

describe.skipIf(!hasDatabase)("npm tasks (integration)", () => {
  beforeAll(async () => {
    await db.delete(repos)
  })

  beforeEach(async () => {
    await db.delete(bundles)
    await db.delete(packages)
  })

  afterAll(async () => {
    await pool.end()
  })

  describe("update-package-data", () => {
    it("re-reads downloads for a package whose version did not change", async () => {
      // The source skipped the download fetch when the version matched, which
      // froze the count at whatever it was when the version last published.
      const projectId = await seedProject("unchanged")
      await upsertPackage(db, projectId, {
        name: "unchanged-pkg",
        version: "1.0.0",
        monthlyDownloads: 100,
      })

      const npm = fakeNpmClient({
        fetchPackageInfo: async () => ({
          name: "unchanged-pkg",
          version: "1.0.0",
        }),
        fetchMonthlyDownloadCount: async () => 9876,
      })

      const result = await createUpdatePackageDataTask(npm).run(fakeContext(db))

      expect(result).toMatchObject({ processed: 1, versionChanged: 0 })
      const stored = await getPackage(db, "unchanged-pkg")
      expect(stored?.version).toBe("1.0.0")
      expect(stored?.monthlyDownloads).toBe(9876)
    })

    it("records a zero download count rather than treating it as missing", async () => {
      // A drop to zero is a real measurement, not an absent one.
      const projectId = await seedProject("zeroed")
      await upsertPackage(db, projectId, {
        name: "zeroed-pkg",
        version: "1.0.0",
        monthlyDownloads: 500,
      })

      await createUpdatePackageDataTask(
        fakeNpmClient({
          fetchPackageInfo: async () => ({
            name: "zeroed-pkg",
            version: "1.0.0",
          }),
          fetchMonthlyDownloadCount: async () => 0,
        })
      ).run(fakeContext(db))

      expect((await getPackage(db, "zeroed-pkg"))?.monthlyDownloads).toBe(0)
    })

    it("keeps the previous download count when the fetch fails", async () => {
      // A zero written on failure would be indistinguishable from a real zero,
      // and the rankings would quietly drop the project.
      const projectId = await seedProject("downloads-fail")
      await upsertPackage(db, projectId, {
        name: "flaky-pkg",
        version: "1.0.0",
        monthlyDownloads: 777,
      })

      const result = await createUpdatePackageDataTask(
        fakeNpmClient({
          fetchPackageInfo: async () => ({
            name: "flaky-pkg",
            version: "2.0.0",
          }),
          fetchMonthlyDownloadCount: async () => {
            throw new Error("downloads API is down")
          },
        })
      ).run(fakeContext(db))

      // The version update still stands even though the count failed.
      const stored = await getPackage(db, "flaky-pkg")
      expect(stored?.version).toBe("2.0.0")
      expect(stored?.monthlyDownloads).toBe(777)
      expect(result).toMatchObject({ updated: 1, versionChanged: 1 })
    })

    it("stores a deprecation message as deprecated", async () => {
      const projectId = await seedProject("deprecated")
      await upsertPackage(db, projectId, { name: "old-pkg", version: "1.0.0" })

      await createUpdatePackageDataTask(
        fakeNpmClient({
          fetchPackageInfo: async () => ({
            name: "old-pkg",
            version: "1.0.1",
            deprecated: "no longer maintained",
          }),
          fetchMonthlyDownloadCount: async () => 1,
        })
      ).run(fakeContext(db))

      const stored = await getPackage(db, "old-pkg")
      expect(stored?.deprecated).toBe(true)
      expect(stored?.version).toBe("1.0.1")
    })

    it("keeps a package the registry no longer serves", async () => {
      // A rename upstream should not unlist the project.
      const projectId = await seedProject("unpublished")
      await upsertPackage(db, projectId, { name: "gone-pkg", version: "1.0.0" })

      const result = await createUpdatePackageDataTask(
        fakeNpmClient({
          fetchPackageInfo: async () => {
            throw new Error("npm registry responded 404")
          },
        })
      ).run(fakeContext(db))

      expect(result).toMatchObject({ errors: 1 })
      expect(await getPackage(db, "gone-pkg")).toBeDefined()
    })

    it("keeps running after one package fails", async () => {
      const projectId = await seedProject("mixed")
      await upsertPackage(db, projectId, { name: "a-pkg", version: "1.0.0" })
      await upsertPackage(db, projectId, { name: "b-pkg", version: "1.0.0" })

      const npm = fakeNpmClient({
        fetchPackageInfo: async (name) => {
          if (name === "a-pkg") throw new Error("boom")
          return { name, version: "1.0.0" }
        },
        fetchMonthlyDownloadCount: async () => 5,
      })

      const result = await createUpdatePackageDataTask(npm).run(fakeContext(db))

      expect(result).toMatchObject({ processed: 1, errors: 1 })
      expect(await getPackage(db, "b-pkg")).toBeDefined()
    })

    it("leaves a package with no project alone rather than inventing one", async () => {
      await upsertPackage(db, null, { name: "orphan-pkg", version: "1.0.0" })

      const result = await createUpdatePackageDataTask(
        fakeNpmClient({
          fetchPackageInfo: async () => ({
            name: "orphan-pkg",
            version: "1.0.0",
          }),
          fetchMonthlyDownloadCount: async () => 3,
        })
      ).run(fakeContext(db))

      expect(result).toMatchObject({ processed: 1 })
      expect((await getPackage(db, "orphan-pkg"))?.projectId).toBeNull()
    })
  })

  describe("update-bundle-size", () => {
    it("measures a package with no stored bundle", async () => {
      const projectId = await seedProject("unmeasured")
      await upsertPackage(db, projectId, {
        name: "fresh-pkg",
        version: "1.0.0",
      })

      const result = await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async () => ({
            size: 100,
            gzip: 40,
            version: "1.0.0",
          }),
        })
      ).run(fakeContext(db))

      expect(result).toMatchObject({ measured: 1, updated: 1 })
      expect(await getBundle(db, "fresh-pkg")).toMatchObject({
        size: 100,
        gzip: 40,
        errorMessage: null,
      })
    })

    it("skips a package already measured at the same version", async () => {
      const projectId = await seedProject("measured")
      await upsertPackage(db, projectId, { name: "same-pkg", version: "1.0.0" })

      const calls: string[] = []
      await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async (name) => {
            calls.push(name)
            return { size: 1, gzip: 1, version: "1.0.0" }
          },
        })
      ).run(fakeContext(db))

      await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async (name) => {
            calls.push(name)
            return { size: 2, gzip: 2, version: "1.0.0" }
          },
        })
      ).run(fakeContext(db))

      expect(calls).toEqual(["same-pkg"])
    })

    it("retries a package whose last attempt timed out", async () => {
      const projectId = await seedProject("timed-out")
      await upsertPackage(db, projectId, { name: "slow-pkg", version: "1.0.0" })
      await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async () => ({ error: "timeout" as const }),
        })
      ).run(fakeContext(db))

      expect((await getBundle(db, "slow-pkg"))?.errorMessage).toBe("timeout")

      const result = await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async () => ({ size: 5, gzip: 2, version: "1.0.0" }),
        })
      ).run(fakeContext(db))

      expect(result).toMatchObject({ updated: 1 })
      expect((await getBundle(db, "slow-pkg"))?.errorMessage).toBeNull()
    })

    it("does not retry a package with no browser bundle", async () => {
      // Retrying forever costs a bundlejs request per package per day and
      // never succeeds, because the answer is a property of the package.
      const projectId = await seedProject("backend-only")
      await upsertPackage(db, projectId, { name: "cli-pkg", version: "1.0.0" })

      const failing = fakeNpmClient({
        fetchBundleData: async () => ({ error: "not-browser-bundle" as const }),
      })

      expect(
        await createUpdateBundleSizeTask(failing).run(fakeContext(db))
      ).toMatchObject({ updated: 0, "not-browser-bundle": 1 })
      expect((await getBundle(db, "cli-pkg"))?.errorMessage).toBe(
        "not-browser-bundle"
      )

      // A second run must not call bundlejs again.
      const counting: NpmClient = fakeNpmClient({
        fetchBundleData: async () => {
          throw new Error("should not be called")
        },
      })
      expect(
        await createUpdateBundleSizeTask(counting).run(fakeContext(db))
      ).toMatchObject({ measured: 0 })
    })

    it("retries a terminal failure once the version moves", async () => {
      const projectId = await seedProject("new-version")
      await upsertPackage(db, projectId, {
        name: "moved-pkg",
        version: "1.0.0",
      })
      await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async () => ({ error: "not-found" as const }),
        })
      ).run(fakeContext(db))

      await upsertPackage(db, projectId, {
        name: "moved-pkg",
        version: "2.0.0",
      })

      const result = await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async () => ({ size: 9, gzip: 3, version: "2.0.0" }),
        })
      ).run(fakeContext(db))

      expect(result).toMatchObject({ measured: 1, updated: 1 })
    })

    it("skips packages of deprecated projects", async () => {
      const projectId = await seedProject("withdrawn", "deprecated")
      await upsertPackage(db, projectId, {
        name: "stale-pkg",
        version: "1.0.0",
      })

      const result = await createUpdateBundleSizeTask(
        fakeNpmClient({
          fetchBundleData: async () => ({ size: 1, gzip: 1, version: "1.0.0" }),
        })
      ).run(fakeContext(db))

      expect(result).toMatchObject({ considered: 0, measured: 0 })
    })
  })
})
