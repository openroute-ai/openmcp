/**
 * npm registry clients.
 *
 * Three independent sources, kept separate because they fail differently:
 * the registry can rate-limit or go down, bundlejs computes a bundle and can
 * time out for tens of seconds, and the downloads API has its own limits.
 */

import pTimeout, { TimeoutError } from "p-timeout"
import { z } from "zod"

/** A long bundle measurement is a real result, not a bug worth aborting on. */
const BUNDLE_TIMEOUT_MS = 100_000

const packageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  deprecated: z.string().optional(),
})

const monthlyDownloadsSchema = z.object({
  downloads: z.number(),
})

const registryPackumentSchema = z.object({
  "dist-tags": z.object({ latest: z.string() }),
  versions: z.record(z.string(), z.unknown()),
})

const bundleDataSchema = z.object({
  version: z.string(),
  size: z.object({
    rawUncompressedSize: z.number(),
    rawCompressedSize: z.number(),
  }),
})

/** A failed bundle measurement is stored, not thrown, so it can be retried. */
export type BundleResult =
  | { size: number; gzip: number; version: string; error?: undefined }
  | { error: "timeout" | "not-browser-bundle" | "not-found" | "error" }

export interface NpmClient {
  fetchPackageInfo(packageName: string): Promise<z.infer<typeof packageJsonSchema>>
  fetchMonthlyDownloadCount(packageName: string): Promise<number>
  fetchBundleData(packageName: string): Promise<BundleResult>
}

/**
 * `redux@5.0.1` -> `5.0.1`.
 *
 * A scoped name such as `@scope/pkg@1.0.0` also has two `@`, so the version
 * is taken from the last separator rather than by counting them.
 */
export function extractPackageVersion(input: string): string {
  const index = input.lastIndexOf("@")
  if (index <= 0) return ""
  return input.slice(index + 1)
}

/** Scoped names contain a slash and must be encoded as a single path segment. */
function encodePackageName(name: string): string {
  // A slash is a path separator in the registry URL; scoping it keeps
  // "@scope/pkg" from being read as "@scope" inside "pkg".
  return name.replace("/", "%2F")
}

export function createNpmClient(
  options: { fetchImpl?: typeof fetch } = {}
): NpmClient {
  const doFetch = options.fetchImpl ?? fetch

  return {
    async fetchPackageInfo(packageName) {
      const url = `https://registry.npmjs.org/${encodePackageName(packageName)}/latest`
      const response = await doFetch(url)

      if (!response.ok) {
        throw new Error(
          `npm registry responded ${response.status} for ${packageName}`,
          { cause: response }
        )
      }

      return packageJsonSchema.parse(await response.json())
    },

    async fetchMonthlyDownloadCount(packageName) {
      const url = `https://api.npmjs.org/downloads/point/last-month/${encodePackageName(packageName)}`
      const response = await doFetch(url)

      // The downloads API answers 200 with an `error` field for an unknown
      // package, so the status alone does not mean the request succeeded.
      if (!response.ok) {
        throw new Error(
          `npm downloads API responded ${response.status} for ${packageName}`,
          { cause: response }
        )
      }

      const body = (await response.json()) as Record<string, unknown>
      if (typeof body.error === "string") {
        throw new Error(`npm downloads API error for ${packageName}: ${body.error}`)
      }

      return monthlyDownloadsSchema.parse(body).downloads
    },

    async fetchBundleData(packageName) {
      const url = `https://deno.bundlejs.com/?q=${encodeURIComponent(packageName)}`

      let body: unknown
      try {
        body = await pTimeout(
          doFetch(url).then((response) => {
            if (!response.ok) {
              throw new Error(`bundlejs responded ${response.status}`)
            }
            return response.json()
          }),
          { milliseconds: BUNDLE_TIMEOUT_MS }
        )
      } catch (error) {
        // A timeout is recorded as its own outcome so the task can tell
        // "bundlejs was slow" apart from "this package has no bundle",
        // and so a slow package is retried rather than written off.
        if (error instanceof TimeoutError) return { error: "timeout" }
        return { error: "error" }
      }

      const raw = body as Record<string, unknown>
      if (typeof raw.error === "string") {
        if (raw.error.toLowerCase().includes("not found")) {
          return { error: "not-found" }
        }
        return { error: "not-browser-bundle" }
      }

      const parsed = bundleDataSchema.safeParse(body)
      if (!parsed.success) return { error: "not-browser-bundle" }

      return {
        size: parsed.data.size.rawUncompressedSize,
        gzip: parsed.data.size.rawCompressedSize,
        version: extractPackageVersion(parsed.data.version),
      }
    },
  }
}

/** The names and ranges of one dependency group, as stored. */
export function toDependencyList(
  dependencies: Record<string, string> | undefined
): string[] | undefined {
  if (!dependencies) return undefined
  const entries = Object.entries(dependencies)
  if (entries.length === 0) return undefined
  // Sorted so the stored JSONB is stable across refreshes; an unstable
  // ordering would make every write look like a change.
  return entries
    .map(([name, version]) => `${name}@${version}`)
    .sort((a, b) => a.localeCompare(b))
}

export interface PackageVersions {
  latest: string
  versions: string[]
}

/** Every published version, newest first. */
export async function fetchPackageVersions(
  packageName: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<PackageVersions> {
  const doFetch = options.fetchImpl ?? fetch
  const url = `https://registry.npmjs.org/${encodePackageName(packageName)}`
  const response = await doFetch(url)

  if (!response.ok) {
    throw new Error(
      `npm registry responded ${response.status} for ${packageName}`,
      { cause: response }
    )
  }

  const data = registryPackumentSchema.parse(await response.json())
  const versions = Object.keys(data.versions)

  return {
    latest: data["dist-tags"].latest,
    // Newest first, judged by publication time so a prerelease does not sort
    // above a newer stable release purely on its semver range.
    versions: versions.sort((a, b) => compareVersions(b, a)),
  }
}

function parseVersion(version: string): {
  major: number
  minor: number
  patch: number
  prerelease: boolean
} {
  const [core = "", ...rest] = version.split("-")
  const [major = "0", minor = "0", patch = "0"] = core.split(".")
  const toNumber = (part: string) => {
    const value = Number.parseInt(part, 10)
    return Number.isNaN(value) ? 0 : value
  }
  return {
    major: toNumber(major),
    minor: toNumber(minor),
    patch: toNumber(patch),
    prerelease: rest.length > 0,
  }
}

/** Semver precedence: 1.0.0 > 1.0.0-rc.1, and a numeric part beats letters. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  // A release outranks a prerelease of the same core version.
  if (left.prerelease !== right.prerelease) return left.prerelease ? -1 : 1
  return 0
}

export const npmClient: NpmClient = createNpmClient()
