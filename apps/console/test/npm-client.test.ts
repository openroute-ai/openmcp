import { describe, expect, it } from "vitest"
import {
  compareVersions,
  createNpmClient,
  extractPackageVersion,
  toDependencyList,
} from "@/lib/npm/client"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("extractPackageVersion", () => {
  it("takes the version after the last separator", () => {
    // A scoped name has a slash, not a second "@", so splitting on "@"
    // needs the last element to be right in both cases.
    expect(extractPackageVersion("redux@5.0.1")).toBe("5.0.1")
    expect(extractPackageVersion("@scope/pkg@1.2.3")).toBe("1.2.3")
  })

  it("returns nothing when there is no version", () => {
    expect(extractPackageVersion("redux")).toBe("")
    // A leading "@" is a scope with no version, not a version.
    expect(extractPackageVersion("@scope/pkg")).toBe("")
  })
})

describe("toDependencyList", () => {
  it("renders name@range and sorts for a stable row", () => {
    expect(toDependencyList({ react: "^18.0.0", "react-dom": "^18.0.0" })).toEqual([
      "react-dom@^18.0.0",
      "react@^18.0.0",
    ])
  })

  it("treats an absent or empty group as no data", () => {
    expect(toDependencyList(undefined)).toBeUndefined()
    expect(toDependencyList({})).toBeUndefined()
  })
})

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0)
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0)
    expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0)
  })

  it("ranks a release above a prerelease of the same version", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0)
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0)
  })

  it("treats equal versions as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
  })

  it("does not throw on an unparseable version", () => {
    // A registry can hold an odd version string; sorting must not blow up.
    expect(() => compareVersions("not-a-version", "1.0.0")).not.toThrow()
  })
})

describe("createNpmClient", () => {
  it("fetches package info from the latest dist-tag", async () => {
    const client = createNpmClient({
      fetchImpl: async () =>
        jsonResponse({ name: "redux", version: "5.0.1" }),
    })

    await expect(client.fetchPackageInfo("redux")).resolves.toMatchObject({
      name: "redux",
      version: "5.0.1",
    })
  })

  it("escapes a scoped name so it is not read as two path segments", async () => {
    const seen: string[] = []
    const client = createNpmClient({
      fetchImpl: async (input) => {
        seen.push(String(input))
        return jsonResponse({ name: "@scope/pkg", version: "1.0.0" })
      },
    })

    await client.fetchPackageInfo("@scope/pkg")
    // Without the escape the URL would contain ".../@scope/pkg/latest", which
    // the registry reads as the package "@scope" and a version path.
    expect(seen[0]).toContain("%2F")
  })

  it("raises on a non-OK registry response", async () => {
    const client = createNpmClient({
      fetchImpl: async () => jsonResponse({}, 404),
    })

    await expect(client.fetchPackageInfo("nope")).rejects.toThrow(/404/)
  })

  it("reads the monthly download count", async () => {
    const client = createNpmClient({
      fetchImpl: async () => jsonResponse({ downloads: 1234 }),
    })

    await expect(client.fetchMonthlyDownloadCount("redux")).resolves.toBe(1234)
  })

  it("treats a 200 with an error field as a failure", async () => {
    // The downloads API answers 200 with an `error` body for an unknown
    // package, so the status alone does not mean success.
    const client = createNpmClient({
      fetchImpl: async () => jsonResponse({ error: "package not found" }),
    })

    await expect(client.fetchMonthlyDownloadCount("nope")).rejects.toThrow(
      /package not found/
    )
  })

  it("maps a bundle measurement to size and gzip", async () => {
    const client = createNpmClient({
      fetchImpl: async () =>
        jsonResponse({
          version: "redux@5.0.1",
          size: { rawUncompressedSize: 1000, rawCompressedSize: 250 },
        }),
    })

    await expect(client.fetchBundleData("redux")).resolves.toEqual({
      size: 1000,
      gzip: 250,
      version: "5.0.1",
    })
  })

  it("reports a package with no browser bundle as such", async () => {
    const client = createNpmClient({
      fetchImpl: async () => jsonResponse({ error: "no bundle found" }),
    })

    await expect(client.fetchBundleData("express")).resolves.toEqual({
      error: "not-browser-bundle",
    })
  })

  it("reports a missing package distinctly from a missing bundle", async () => {
    const client = createNpmClient({
      fetchImpl: async () => jsonResponse({ error: "Package not found" }),
    })

    await expect(client.fetchBundleData("nope")).resolves.toEqual({
      error: "not-found",
    })
  })

  it("returns an error rather than throwing when the response is not a bundle", async () => {
    // A timeout or a schema mismatch is a result to record and retry, not an
    // exception that aborts the whole sweep.
    const client = createNpmClient({
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    })

    await expect(client.fetchBundleData("weird")).resolves.toEqual({
      error: "not-browser-bundle",
    })
  })
})
