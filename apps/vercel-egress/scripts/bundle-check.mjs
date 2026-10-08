/**
 * `bundle:check` — verify the production entry actually bundles.
 *
 * Local `tsx` runs against `@workspace/security-scan`'s raw `src/index.ts`, so
 * typecheck alone never proves the shape Vercel deploys: the function builder
 * compiles the entry and resolves the workspace dep through pnpm's node_modules.
 * That chain is exactly what `pnpm bundle` exercises — esbuild follows the same
 * resolution from `api/[[...route]].ts` and must inline the security-scan
 * source, not leave an import to `.ts` that no runtime can load.
 *
 * Runs: `pnpm bundle` then assertions on the emitted ESM.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const outfile = join(process.cwd(), ".turbo", "bundle-check.mjs")
const bundled = readFileSync(outfile, "utf8")

const failures = []
if (!bundled.includes("SCAN_RULES_VERSION")) {
  failures.push(
    "@workspace/security-scan is missing from the bundle (was it resolved at all?)"
  )
}
if (bundled.includes("@workspace/security-scan")) {
  failures.push("@workspace/security-scan was left as an external import")
}
if (failures.length > 0) {
  for (const failure of failures)
    console.error("bundle:check failed — " + failure)
  process.exit(1)
}

console.log(
  `bundle:check ok (${Buffer.byteLength(bundled, "utf8")} bytes, security-scan inlined)`
)
