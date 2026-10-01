"use client"

import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { monthOfPeriod } from "@/lib/github/snapshot-dates"
import { Badge } from "@workspace/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  IconArrowLeft,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react"
import { ProjectLogo } from "@/components/projects/project-logo"
import { CreateProjectDialog } from "@/components/projects/create-project-dialog"
import { AuthorCard } from "@/components/authors/author-card"
import { ProjectDeleteDialog } from "@/components/projects/project-delete-dialog"
import { ProjectEditDialog } from "@/components/projects/project-edit-dialog"
import {
  AddPackageButton,
  RemovePackageButton,
} from "@/components/projects/project-packages"
import { ProjectTrends } from "@/components/projects/project-trends"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import {
  DescriptionPair,
  LabelRow,
  ReadmeViewer,
} from "@/components/projects/readme-viewer"
import { SyncStatusBadge } from "@/components/status-badge"
import { LocaleLink } from "@/i18n/navigation"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { useTRPC } from "@/lib/trpc/client"

/** How many sync runs the page shows. Enough to spot a pattern, short of a log. */
const JOB_LIMIT = 20

/** How many months of star history the table shows. */
const MONTH_LIMIT = 24

/**
 * How often the page re-reads while a resync is in flight.
 *
 * Fast enough that a short resync looks instant, slow enough that an operator
 * watching the page does not generate a request per second for the minutes a
 * README translation can take. The interval stops on its own once no job is
 * outstanding, so an idle page costs nothing.
 */
const POLL_INTERVAL_MS = 3_000

/**
 * A label and its value, in the pair layout a description list expects.
 *
 * A `<div>` inside `<dl>` rather than a bare pair, because each of these is a
 * small group with a caption above it rather than a term running into a
 * definition on the same line.
 */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </dl>
  )
}

/** An external link that says where it goes, rather than a bare arrow. */
function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
    >
      {children}
      <IconExternalLink className="size-3.5 shrink-0" />
    </a>
  )
}

/** A read-only image preview, for the mirrored icon and Open Graph image. */
function AssetPreview({
  url,
  alt,
  fallback,
}: {
  url: string | null
  alt: string
  fallback: string
}) {
  const common = useTranslations("Common")
  if (!url) {
    return <p className="text-sm text-muted-foreground">{common("none")}</p>
  }
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className="size-16 rounded-md border object-contain"
      />
      <ExternalLink href={url}>{fallback}</ExternalLink>
    </div>
  )
}

export function ProjectDetail({ id }: { id: string }) {
  const formats = useFormats()
  const format = useFormatter()
  const t = useTranslations("ProjectDetail")
  const projectsT = useTranslations("Projects")
  const common = useTranslations("Common")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const triggerLabel = useEnumLabel("Trigger")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const { data, isPending, isError } = useQuery(
    trpc.projects.byId.queryOptions({ id })
  )

  const sync = useMutation(trpc.projects.sync.mutationOptions())

  // A resync is running while the newest job for this project has not closed.
  // Derived from the job rows rather than from the mutation, because the
  // mutation is settled long before the work is: the server answers as soon as
  // the job is queued, and the run itself continues for minutes.
  const latestJob = data?.jobs[0]
  const outstanding = Boolean(
    latestJob &&
    (latestJob.status === "pending" || latestJob.status === "running")
  )

  // Poll only while something is outstanding. Keyed on that flag rather than on
  // the data, so the interval is not torn down and rebuilt on every tick, and an
  // idle page runs no timer at all. There is a gap of one refetch between the
  // mutation settling and the running job row appearing, during which nothing is
  // polled; the button is briefly enabled again there, and the server's own
  // guard turns a double click into a clear conflict rather than a second run.
  useEffect(() => {
    if (!outstanding) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: trpc.projects.byId.queryKey({ id }),
      })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [outstanding, id, queryClient, trpc.projects.byId])

  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  // A project is deleted from under a stale link, and from a mistyped id, in
  // the same way; both are the address pointing at nothing, so both answer the
  // same and offer the same way back.
  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>{t("notFoundDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <LocaleLink href="/dashboard/projects">
              <IconArrowLeft />
              {t("backToProjects")}
            </LocaleLink>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const number = (value: number | null | undefined) =>
    value == null ? common("none") : format.number(value)

  const list = (values: string[] | null | undefined) =>
    values && values.length > 0 ? values.join(" · ") : null

  // The license is one identifier rather than a list, so it is rendered on its
  // own instead of through `list`, which would read an absent one as absent.
  const license = data.licenseSpdxId || common("none")

  // Newest first. The rows already carry the change alongside the level, so the
  // table shows both without subtracting anything here.
  const months = data.monthlyStats
    .map((row) => ({
      ...monthOfPeriod(row.period),
      stars: row.totalStars,
      newStars: row.deltaNewStars,
      totalContributors: row.totalContributors,
      totalPullRequests: row.totalPullRequests,
      totalReleases: row.totalReleases,
    }))
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .slice(0, MONTH_LIMIT)

  const busy = sync.isPending || outstanding

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <LocaleLink href="/dashboard/projects">
                {projectsT("title")}
              </LocaleLink>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{data.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <ProjectLogo
              name={data.name}
              logo={data.logo}
              avatar={githubAvatarUrl(data.owner, {
                ownerId: data.ownerId,
                // Twice the 56px slot, for a 2x display.
                size: 112,
              })}
              iconUrl={data.iconUrl}
              className="size-14"
            />
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">{data.name}</CardTitle>
                <Badge variant="secondary">{typeLabel(data.type)}</Badge>
                <Badge variant="outline">{statusLabel(data.status)}</Badge>
                {data.archived ? (
                  <Badge variant="outline">{t("archived")}</Badge>
                ) : null}
                {data.overrideDescription ? (
                  <Badge variant="outline">{t("descriptionOverridden")}</Badge>
                ) : null}
                {data.overrideUrl ? (
                  <Badge variant="outline">{t("urlOverridden")}</Badge>
                ) : null}
              </div>
              <CardDescription>
                <ExternalLink href={data.repoUrl}>
                  {data.owner}/{data.name}
                </ExternalLink>
              </CardDescription>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {data.url ? (
                  <ExternalLink href={data.url}>{t("homepage")}</ExternalLink>
                ) : null}
                {data.twitter ? (
                  <ExternalLink href={data.twitter}>
                    {t("twitter")}
                  </ExternalLink>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Adding the next project from a project page: the operator is
                  already here, and the alternative is walking back to the list
                  to press the one button that creates something. */}
              <CreateProjectDialog />
              <ProjectEditDialog
                project={{
                  id: data.id,
                  name: data.name,
                  description: data.description,
                  url: data.url,
                  status: data.status,
                  type: data.type,
                  logo: data.logo,
                  twitter: data.twitter,
                  priority: data.priority,
                  comments: data.comments,
                  skillMdPath: data.skillMdPath,
                  tags: data.tags,
                }}
              />
              <ProjectDeleteDialog id={data.id} name={data.name} />
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  sync.mutate(
                    { id },
                    {
                      onSuccess: () => {
                        toast.success(t("resyncStarted"))
                        void queryClient.invalidateQueries({
                          queryKey: trpc.projects.byId.queryKey({ id }),
                        })
                      },
                      onError: (error) => {
                        toast.error(t("resyncFailed"), {
                          description: error.message,
                        })
                      },
                    }
                  )
                }}
              >
                {busy ? <Spinner /> : <IconRefresh />}
                {busy ? t("resyncing") : t("resync")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <DescriptionPair
            description={data.description}
            descriptionZh={data.repoDescriptionZh}
          />
          {data.repoDescription && data.repoDescription !== data.description ? (
            <p className="text-xs text-muted-foreground">
              {t("repoDescription")}: {data.repoDescription}
            </p>
          ) : null}
          {data.tags.length > 0 ? (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                {t("tagsLabel")}
              </span>
              <div className="flex flex-wrap gap-1">
                {data.tags.map((tag) => (
                  <Badge
                    key={tag.code}
                    variant="secondary"
                    title={tag.description ?? undefined}
                  >
                    {tag.name || tag.code}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ReadmeViewer
        readmeContent={data.readmeContent}
        readmeContentZh={data.readmeContentZh}
        fallback={
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => sync.mutate({ id })}
          >
            <IconRefresh />
            {t("resyncToFetch")}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("curation")}</CardTitle>
          <CardDescription>{t("curationDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label={t("field.slug")}>
              <code className="text-xs">{data.slug}</code>
            </Field>
            <Field label={t("field.priority")}>
              {format.number(data.priority)}
            </Field>
            <Field label={t("field.skillPath")}>
              <code className="text-xs">
                {data.skillMdPath ?? common("none")}
              </code>
            </Field>
            <Field label={t("field.added")}>
              {formats.relative(data.createdAt)}
            </Field>
            <Field label={t("field.updated")}>
              {data.updatedAt
                ? formats.relative(data.updatedAt)
                : common("never")}
            </Field>
            <Field label={t("field.notes")}>
              {data.comments ?? common("none")}
            </Field>
            <Field label={t("field.owner")}>{data.owner}</Field>
            <Field label={t("field.repoId")}>
              <code className="text-xs">{data.repoId}</code>
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("repository")}</CardTitle>
          <CardDescription>{t("repositoryDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label={t("field.stars")}>{number(data.stars)}</Field>
            <Field label={t("field.forks")}>{number(data.forks)}</Field>
            <Field label={t("field.watchers")}>
              {number(data.watchersCount)}
            </Field>
            <Field label={t("field.contributors")}>
              {number(data.contributorCount)}
            </Field>
            <Field label={t("field.commits")}>{number(data.commitCount)}</Field>
            <Field label={t("field.mentionable")}>
              {number(data.mentionableUsersCount)}
            </Field>
            <Field label={t("field.pullRequests")}>
              {number(data.pullRequestsCount)}
            </Field>
            <Field label={t("field.releases")}>
              {number(data.releasesCount)}
            </Field>
            <Field label={t("field.license")}>{license}</Field>
            <Field label={t("field.defaultBranch")}>
              <code className="text-xs">
                {data.defaultBranch ?? common("none")}
              </code>
            </Field>
            <Field label={t("field.languages")}>
              <LabelRow
                items={list(data.languages) ? [list(data.languages)!] : []}
              />
            </Field>
            <Field label={t("field.topics")}>
              <LabelRow items={data.topics ?? []} />
            </Field>
            <Field label={t("field.lastCommit")}>
              {formats.relative(data.lastCommit)}
            </Field>
            <Field label={t("field.pushed")}>
              {formats.relative(data.pushedAt)}
            </Field>
            <Field label={t("field.repoCreated")}>
              {formats.relative(data.repoCreatedAt)}
            </Field>
            <Field label={t("field.repoAdded")}>
              {formats.relative(data.repoAddedAt)}
            </Field>
            <Field label={t("field.repoUpdated")}>
              {data.repoUpdatedAt
                ? formats.relative(data.repoUpdatedAt)
                : common("never")}
            </Field>
            <Field label={t("field.homepage")}>
              {data.homepage ? (
                <ExternalLink href={data.homepage}>
                  {data.homepage}
                </ExternalLink>
              ) : (
                common("none")
              )}
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("assets")}</CardTitle>
          <CardDescription>{t("assetsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label={t("field.icon")}>
              <AssetPreview
                url={data.iconUrl}
                alt={t("field.icon")}
                fallback={t("viewOriginal")}
              />
            </Field>
            <Field label={t("field.openGraphImage")}>
              <AssetPreview
                url={data.openGraphImageOssUrl ?? data.openGraphImageUrl}
                alt={t("field.openGraphImage")}
                fallback={t("viewOriginal")}
              />
            </Field>
            <Field label={t("field.customOgImage")}>
              {data.usesCustomOpenGraphImage
                ? t("yes")
                : data.usesCustomOpenGraphImage === false
                  ? t("no")
                  : common("none")}
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("latestRelease")}</CardTitle>
          <CardDescription>{t("latestReleaseDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.latestReleaseName || data.latestReleaseTagName ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {data.latestReleaseName ?? common("none")}
                </span>
                {data.latestReleaseTagName ? (
                  <Badge variant="secondary">{data.latestReleaseTagName}</Badge>
                ) : null}
                {data.latestReleaseUrl ? (
                  <ExternalLink href={data.latestReleaseUrl}>
                    {t("viewRelease")}
                  </ExternalLink>
                ) : null}
                {data.latestReleasePublishedAt ? (
                  <span className="text-muted-foreground">
                    {formats.relative(data.latestReleasePublishedAt)}
                  </span>
                ) : null}
              </div>
              {data.latestReleaseDescription ? (
                <p className="text-sm whitespace-pre-line">
                  {data.latestReleaseDescription}
                </p>
              ) : null}
              {data.latestReleaseDescriptionZh &&
              data.latestReleaseDescriptionZh !==
                data.latestReleaseDescription ? (
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {data.latestReleaseDescriptionZh}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noRelease")}</p>
          )}
        </CardContent>
      </Card>

      {/* Shown even with no packages: the card is where a package gets added,
          and a page with no packages would otherwise have nowhere to say so. */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <CardTitle>{t("packages")}</CardTitle>
              <CardDescription>{t("packagesDescription")}</CardDescription>
            </div>
            <AddPackageButton projectId={data.id} />
          </div>
        </CardHeader>
        <CardContent>
          {data.packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPackages")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.package")}</TableHead>
                  <TableHead>{t("column.version")}</TableHead>
                  <TableHead>{t("column.downloads")}</TableHead>
                  <TableHead>{t("column.gzip")}</TableHead>
                  <TableHead>{t("column.size")}</TableHead>
                  <TableHead>{t("column.dependencies")}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t("column.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.packages.map((pkg) => (
                  <TableRow key={pkg.name}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ExternalLink
                          href={`https://www.npmjs.com/package/${pkg.name}`}
                        >
                          {pkg.name}
                        </ExternalLink>
                        {pkg.deprecated ? (
                          <Badge variant="outline">
                            {t("deprecatedPackage")}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {pkg.version ?? common("none")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {number(pkg.monthlyDownloads)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {pkg.bundleGzip == null
                        ? common("none")
                        : format.number(pkg.bundleGzip)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {pkg.bundleSize == null
                        ? common("none")
                        : format.number(pkg.bundleSize)}
                    </TableCell>
                    <TableCell>
                      {pkg.bundleError ? (
                        <span
                          className="block max-w-60 truncate text-xs text-destructive"
                          title={pkg.bundleError}
                        >
                          {pkg.bundleError}
                        </span>
                      ) : pkg.dependencies && pkg.dependencies.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {pkg.dependencies.join(", ")}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {common("none")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <RemovePackageButton
                        projectId={data.id}
                        packageName={pkg.name}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.trends ? (
        <ProjectTrends
          bars={data.trends.bars}
          weeks={data.trends.weeks}
          periods={data.trends.periods}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                sync.mutate(
                  { id },
                  {
                    onSuccess: () => {
                      toast.success(t("snapshotRecorded"))
                      void queryClient.invalidateQueries({
                        queryKey: trpc.projects.byId.queryKey({ id }),
                      })
                    },
                    onError: (error) => {
                      toast.error(t("snapshotFailed"), {
                        description: error.message,
                      })
                    },
                  }
                )
              }}
            >
              {busy ? <Spinner /> : <IconRefresh />}
              {busy ? t("resyncing") : t("recordSnapshot")}
            </Button>
          }
        />
      ) : null}

      {months.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
            <CardDescription>
              {t("historyDescription", { count: MONTH_LIMIT })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.month")}</TableHead>
                  <TableHead>{t("column.stars")}</TableHead>
                  <TableHead>{t("column.newStars")}</TableHead>
                  <TableHead>{t("column.contributors")}</TableHead>
                  <TableHead>{t("column.pullRequests")}</TableHead>
                  <TableHead>{t("column.releases")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((month) => (
                  <TableRow key={`${month.year}-${month.month}`}>
                    <TableCell className="text-muted-foreground">
                      {month.year}-{String(month.month).padStart(2, "0")}
                    </TableCell>
                    <TableCell>{number(month.stars)}</TableCell>
                    <TableCell>{number(month.newStars)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {number(month.totalContributors)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {number(month.totalPullRequests)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {number(month.totalReleases)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("skills")}</CardTitle>
          <CardDescription>{t("skillsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSkills")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.skill")}</TableHead>
                  <TableHead>{t("column.directory")}</TableHead>
                  <TableHead>{t("column.version")}</TableHead>
                  <TableHead>{t("column.translated")}</TableHead>
                  <TableHead>{t("column.syncedToWeb")}</TableHead>
                  <TableHead>{t("column.lastAttempt")}</TableHead>
                  <TableHead>{t("column.error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.skills.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell>
                      <div className="font-medium">{skill.name}</div>
                      <div className="max-w-80 truncate text-xs text-muted-foreground">
                        {skill.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">
                        {skill.skillDir}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {skill.version ?? common("none")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {skill.readmeZhLength > 0
                        ? t("translatedYes")
                        : t("translatedNo")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {skill.syncedToWebAt
                        ? formats.relative(skill.syncedToWebAt)
                        : common("never")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {skill.lastSyncAttemptAt
                        ? formats.relative(skill.lastSyncAttemptAt)
                        : common("none")}
                    </TableCell>
                    <TableCell>
                      {skill.lastSyncError ? (
                        <span
                          className="block max-w-60 truncate text-xs text-destructive"
                          title={skill.lastSyncError}
                        >
                          {skill.lastSyncError}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {common("none")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <CardTitle>{t("syncJobs")}</CardTitle>
              <CardDescription>
                {t("syncJobsDescription", { count: JOB_LIMIT })}
              </CardDescription>
            </div>
            {busy ? (
              <Badge variant="outline">
                <Spinner />
                {t("resyncing")}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {data.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noJobs")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.status")}</TableHead>
                  <TableHead>{t("column.trigger")}</TableHead>
                  <TableHead>{t("column.started")}</TableHead>
                  <TableHead>{t("column.completed")}</TableHead>
                  <TableHead>{t("column.error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <SyncStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {triggerLabel(job.triggeredBy)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(job.startedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(job.completedAt)}
                    </TableCell>
                    <TableCell>
                      {job.errorMessage ? (
                        <span
                          className="block max-w-60 truncate text-xs text-destructive"
                          title={job.errorMessage}
                        >
                          {job.errorMessage}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {common("none")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("authors")}</CardTitle>
          <CardDescription>{t("authorsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.authors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noAuthors")}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.authors.map((author) => (
                <AuthorCard key={author.username} author={author} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
