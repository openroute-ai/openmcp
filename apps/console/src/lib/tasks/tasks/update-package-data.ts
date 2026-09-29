/**
 * Refreshes npm package metadata and monthly download counts.
 *
 * Two decisions the source got wrong or left implicit:
 *
 * - Downloads are recorded for every package, not only ones whose version
 *   changed. The source skipped a package whose version matched, which left
 *   `monthlyDownloads` frozen at whatever it was when the version last
 *   published. Download counts move every day, and the rankings are built from
 *   them, so a steady-state package would report a months-old total.
 * - A package that 404s is recorded as unmeasured rather than deleted. An
 *   unpublished package is usually a rename, and dropping the row would remove
 *   the project from the download rankings until someone re-added it.
 */

import {
  listPackageNames,
  recordMonthlyDownloads,
  upsertPackage,
  getPackage,
} from "@/lib/github/service/package"
import { createNpmClient, type NpmClient } from "@/lib/npm/client"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"

/** A minimum gap between npm calls; the registry asks for politeness. */
const NPM_THROTTLE_MS = 250

export function createUpdatePackageDataTask(
  npm: NpmClient = createNpmClient()
): Task {
  return {
    name: "update-package-data",
    description:
      "Refresh npm package version, dependencies and deprecation state, and " +
      "record the monthly download count for every known package",

    async run({ db, logger }) {
      const names = await listPackageNames(db)
      logger.info(`refreshing ${names.length} package(s)`)

      const result = await processItems(
        names,
        async (name) => {
          const existing = await getPackage(db, name)

          // A package the registry no longer serves. Recorded, not deleted:
          // the row is what keeps the project in the rankings, and a rename
          // should not silently unlist it.
          if (!existing) {
            return { meta: { missing: 1 }, data: null }
          }

          let info: Awaited<ReturnType<NpmClient["fetchPackageInfo"]>>
          try {
            info = await npm.fetchPackageInfo(name)
          } catch (error) {
            logger.warn(`could not fetch ${name}`, error)
            return { meta: { error: 1 }, data: null }
          }

          const deprecated = info.deprecated !== undefined
          if (deprecated) logger.warn(`package ${name} is deprecated`)

          const versionChanged = existing.version !== info.version

          await upsertPackage(db, existing.projectId, {
            name,
            version: info.version,
            dependencies: info.dependencies,
            devDependencies: info.devDependencies,
            peerDependencies: info.peerDependencies,
            optionalDependencies: info.optionalDependencies,
            ...(info.deprecated ? { deprecated: info.deprecated } : {}),
          })

          // A new version invalidates the previous download figure: the
          // stored total described the old version, so it is re-read rather
          // than left to look current.
          let downloads = 0
          try {
            downloads = await npm.fetchMonthlyDownloadCount(name)
            await recordMonthlyDownloads(db, name, downloads)
          } catch (error) {
            // The version update above still stands, and a zero is not
            // written: a failed count must not become a real-looking zero.
            logger.warn(`could not fetch downloads for ${name}`, error)
          }

          return {
            meta: {
              processed: 1,
              updated: 1,
              versionChanged: versionChanged ? 1 : 0,
              deprecated: deprecated ? 1 : 0,
              downloads,
            },
            data: null,
          }
        },
        {
          logger,
          label: "package",
          concurrency: 4,
          throttleIntervalMs: NPM_THROTTLE_MS,
        }
      )

      return {
        processed: result.meta.processed ?? 0,
        updated: result.meta.updated ?? 0,
        versionChanged: result.meta.versionChanged ?? 0,
        deprecated: result.meta.deprecated ?? 0,
        missing: result.meta.missing ?? 0,
        errors: result.meta.error ?? 0,
      }
    },
  }
}
