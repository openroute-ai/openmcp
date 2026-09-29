/**
 * Package and bundle-size persistence.
 *
 * A package row is the metadata for one npm name; a bundle row is the
 * measured cost of that name when it is bundled for the browser. Bundles are
 * a strict subset of packages, so a package with no browser entry point has
 * no bundle row and no measurement is invented for it.
 */

import { eq, inArray, isNotNull, ne, and } from "drizzle-orm"
import { bundles, packages, projects } from "@/db/schema"
import type { Db } from "@/lib/github/service/repo"
import { toDependencyList } from "@/lib/npm/client"

type PackageRow = typeof packages.$inferSelect
type BundleRow = typeof bundles.$inferSelect

export interface PackageInput {
  name: string
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  /** npm sets this to a message rather than a boolean. */
  deprecated?: string
  monthlyDownloads?: number
}

export interface BundleInput {
  name: string
  version?: string | null
  size?: number | null
  gzip?: number | null
  errorMessage?: string | null
}

function toPackageRow(projectId: string | null, input: PackageInput) {
  return {
    projectId,
    version: input.version,
    dependencies: toDependencyList(input.dependencies),
    devDependencies: toDependencyList(input.devDependencies),
    deprecated: input.deprecated !== undefined,
    // Omitted rather than nulled when the caller has no figure. A version
    // refresh carries no download count, and writing null here would wipe the
    // stored one — which then reads as "this package has zero downloads"
    // whenever the separate download fetch also fails.
    ...(input.monthlyDownloads !== undefined
      ? { monthlyDownloads: input.monthlyDownloads }
      : {}),
    updatedAt: new Date(),
  }
}

/**
 * Stores a package against its project.
 *
 * Ownership is updated but never cleared: a package that has lost its
 * project row is a project that was removed upstream, and dropping the
 * association here would turn a transient upstream gap into permanent data
 * loss for a package the site still serves.
 */
export async function upsertPackage(
  db: Db,
  projectId: string | null,
  input: PackageInput
): Promise<void> {
  const row = toPackageRow(projectId, input)
  await db
    .insert(packages)
    .values({ name: input.name, ...row })
    .onConflictDoUpdate({ target: packages.name, set: row })
}

export async function upsertPackages(
  db: Db,
  projectId: string | null,
  inputs: PackageInput[]
): Promise<void> {
  for (const input of inputs) {
    await upsertPackage(db, projectId, input)
  }
}

/**
 * Records a bundle measurement.
 *
 * A failed measurement is written with its error rather than skipped, so the
 * task can tell a package that has no browser bundle from one that was never
 * attempted.
 */
export async function upsertBundle(db: Db, input: BundleInput): Promise<void> {
  const row = {
    version: input.version ?? null,
    size: input.size ?? null,
    gzip: input.gzip ?? null,
    errorMessage: input.errorMessage ?? null,
    updatedAt: new Date(),
  }
  await db
    .insert(bundles)
    .values({ name: input.name, ...row })
    .onConflictDoUpdate({ target: bundles.name, set: row })
}

export async function getPackage(
  db: Db,
  name: string
): Promise<PackageRow | undefined> {
  return db.query.packages.findFirst({ where: eq(packages.name, name) })
}

export async function getBundle(
  db: Db,
  name: string
): Promise<BundleRow | undefined> {
  return db.query.bundles.findFirst({ where: eq(bundles.name, name) })
}

export async function listPackagesForProject(
  db: Db,
  projectId: string
): Promise<PackageRow[]> {
  return db
    .select()
    .from(packages)
    .where(eq(packages.projectId, projectId))
    .orderBy(packages.name)
}

/** Packages that have a measured bundle and therefore can run in a browser. */
export async function listBundles(
  db: Db,
  names: string[]
): Promise<BundleRow[]> {
  if (names.length === 0) return []
  return db
    .select()
    .from(bundles)
    .where(inArray(bundles.name, names))
    .orderBy(bundles.name)
}

export type BundleOutcome =
  "updated" | "same-version" | "error" | "timeout" | "not-browser-bundle"

/**
 * Outcomes that will not change by trying again.
 *
 * `not-found` and `not-browser-bundle` are statements about the package, not
 * about the attempt: the name does not resolve, or it has no browser entry
 * point. Retrying those on every run costs a bundlejs request per package per
 * day forever and never succeeds. A timeout or a plain error is a statement
 * about the attempt, so those are retried.
 */
const TERMINAL_BUNDLE_OUTCOMES = new Set(["not-found", "not-browser-bundle"])

/**
 * Decides whether a bundle needs re-measuring.
 *
 * A failed attempt means "try again" unless it failed terminally, since a
 * timeout may well succeed next time. Otherwise the measurement is only valid
 * while the package version is unchanged.
 */
export function needsBundleUpdate(
  packageVersion: string | null | undefined,
  bundle: Pick<BundleRow, "version" | "errorMessage"> | undefined
): boolean {
  if (!bundle) return true

  // An unknown version cannot be shown to match, so a stored measurement is
  // never assumed current.
  if (packageVersion === null || packageVersion === undefined) return true

  const versionMoved = packageVersion !== bundle.version

  if (bundle.errorMessage) {
    // A new version warrants a fresh attempt even after a terminal failure:
    // the previous answer described the previous version.
    return versionMoved || !TERMINAL_BUNDLE_OUTCOMES.has(bundle.errorMessage)
  }

  return versionMoved
}

/** The error column value for a measurement outcome. */
export function bundleErrorFor(outcome: BundleOutcome): string | null {
  return outcome === "updated" ? null : outcome
}

/**
 * Records the monthly download count.
 *
 * A zero is stored as zero: unlike a repository's star counter, the downloads
 * API reports a real measurement, so a package dropping to zero downloads is
 * a genuine fact and must overwrite the previous total.
 */
export async function recordMonthlyDownloads(
  db: Db,
  name: string,
  downloads: number
): Promise<void> {
  await db
    .update(packages)
    .set({ monthlyDownloads: downloads, updatedAt: new Date() })
    .where(eq(packages.name, name))
}

export async function listProjectsWithPackages(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ projectId: packages.projectId })
    .from(packages)
    .where(isNotNull(packages.projectId))

  return rows.flatMap((row) => (row.projectId ? [row.projectId] : []))
}

/** Every package name, for a sweep. */
export async function listPackageNames(db: Db): Promise<string[]> {
  const rows = await db.select({ name: packages.name }).from(packages)
  return rows.map((row) => row.name)
}

export interface MonthlyDownload {
  year: number
  month: number
  downloads: number
}

/**
 * Sums a daily download series into months.
 *
 * Days are bucketed by the leading `yyyy-mm` of the API's `day` field, which
 * is already UTC, so no local-time conversion is involved.
 */
export function groupDownloadsByMonth(
  daily: { day: string; downloads: number }[]
): MonthlyDownload[] {
  const totals = new Map<string, number>()

  for (const { day, downloads } of daily) {
    if (typeof day !== "string" || day.length < 7) continue
    const key = day.slice(0, 7)
    totals.set(key, (totals.get(key) ?? 0) + downloads)
  }

  return [...totals.entries()]
    .map(([key, downloads]) => ({
      year: Number.parseInt(key.slice(0, 4), 10),
      month: Number.parseInt(key.slice(5, 7), 10),
      downloads,
    }))
    .sort((a, b) => a.year - b.year || a.month - b.month)
}

/**
 * The window of the monthly download series.
 *
 * The first of the current month is the end of the interval, so the current
 * partial month is excluded rather than reported as a collapse in downloads.
 */
export function downloadRangeDates(today: Date): {
  startDate: string
  endDate: string
} {
  const firstOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  )
  const startDate = new Date(firstOfMonth)
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1)
  // The day before the first of the month: a one-year window that stops on a
  // month boundary, so every month in it is complete.
  const endDate = new Date(firstOfMonth.getTime() - 86_400_000)

  const format = (date: Date) => date.toISOString().slice(0, 10)
  return { startDate: format(startDate), endDate: format(endDate) }
}

export interface ProjectPackage {
  project: typeof projects.$inferSelect
  package: PackageRow
  bundle?: BundleRow
}

/**
 * A project and the packages it publishes, with any measurements attached.
 *
 * Deprecated projects are excluded, matching the source task: bundling a
 * package that has been withdrawn is wasted work.
 */
export async function listPackagesWithBundles(
  db: Db
): Promise<ProjectPackage[]> {
  const rows = await db
    .select({ project: projects, package: packages, bundle: bundles })
    .from(packages)
    .innerJoin(projects, eq(packages.projectId, projects.id))
    // Left join because most packages have no browser bundle; the inner join
    // would silently drop every backend-only package from the listing.
    .leftJoin(bundles, eq(bundles.name, packages.name))
    .where(
      and(ne(projects.status, "deprecated"), isNotNull(packages.projectId))
    )

  return rows.map((row) => ({
    project: row.project,
    package: row.package,
    bundle: row.bundle ?? undefined,
  }))
}

export type { BundleRow, PackageRow }
