/**
 * Re-measures browser bundle sizes.
 *
 * The source task skipped any project tagged as backend-only, using a
 * hardcoded list of 38 tag codes. That list was the only thing standing between
 * a CLI framework and a 100-second bundlejs timeout, and it went stale
 * whenever a tag was added. Here the decision is made from what bundlejs
 * actually reported last time: a package recorded as `not-browser-bundle` or
 * `not-found` is not retried, and anything else is.
 *
 * A timeout is retried rather than written off, since it says nothing about
 * whether the package has a browser build.
 */

import {
  listPackagesWithBundles,
  needsBundleUpdate,
  upsertBundle,
} from "@/lib/github/service/package"
import { createNpmClient, type NpmClient } from "@/lib/npm/client"
import { processItems } from "@/lib/tasks/iterate"
import type { Task } from "@/lib/tasks/runner"

/**
 * bundlejs is slow, so requests are serialised. Running them in parallel
 * would just queue at their end and make a timeout more likely.
 */
const BUNDLE_THROTTLE_MS = 0

export function createUpdateBundleSizeTask(
  npm: NpmClient = createNpmClient()
): Task {
  return {
    name: "update-bundle-size",
    description:
      "Re-measure browser bundle sizes for packages whose version changed or " +
      "whose previous measurement failed",

    async run({ db, logger }) {
      const rows = await listPackagesWithBundles(db)
      const due = rows.filter((row) =>
        needsBundleUpdate(row.package.version, row.bundle)
      )
      logger.info(`${due.length} of ${rows.length} package(s) need measuring`)

      const result = await processItems(
        due,
        async ({ package: pkg }) => {
          const measured = await npm.fetchBundleData(pkg.name)

          const outcome = measured.error
          if (outcome !== undefined) {
            // The failure is stored rather than thrown, so the next run can
            // tell a package that has no browser bundle from one that was
            // never measured.
            await upsertBundle(db, {
              name: pkg.name,
              version: pkg.version,
              errorMessage: outcome,
            })
            return { meta: { [outcome]: 1 }, data: null }
          }

          await upsertBundle(db, {
            name: pkg.name,
            version: measured.version,
            size: measured.size,
            gzip: measured.gzip,
          })
          return { meta: { updated: 1 }, data: null }
        },
        {
          logger,
          label: "bundle",
          // Matches BUNDLE_THROTTLE_MS's reason: serialised, because a
          // parallel request does not finish sooner, it just occupies a second
          // slot on a slow upstream until it times out.
          concurrency: 1,
          throttleIntervalMs: BUNDLE_THROTTLE_MS,
        }
      )

      return {
        considered: rows.length,
        measured: due.length,
        updated: result.meta.updated ?? 0,
        timeout: result.meta.timeout ?? 0,
        "not-found": result.meta["not-found"] ?? 0,
        "not-browser-bundle": result.meta["not-browser-bundle"] ?? 0,
        error: result.meta.error ?? 0,
      }
    },
  }
}
