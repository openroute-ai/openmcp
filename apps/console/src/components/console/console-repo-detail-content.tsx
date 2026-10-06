"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
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
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react"
import {
  DescriptionPair,
  LabelRow,
  ReadmeViewer,
} from "@/components/projects/readme-viewer"
import { ProjectTrends } from "@/components/projects/project-trends"
import { ProjectLogo } from "@/components/projects/project-logo"
import { githubAvatarUrl } from "@/lib/github/avatar-url"
import { LocaleLink } from "@/i18n/navigation"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { useTRPC } from "@/lib/trpc/client"

/** How many months of star history the table shows. */
const MONTH_LIMIT = 24

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

/**
 * One repository, read.
 *
 * Everything the operator's repository row holds, minus the three things that
 * would make it an editor: the description and homepage flags, the refresh, and
 * the delete. The row is a curation record, and curating is what `/console`
 * exists for a reader to watch, not to perform — so a repository is here
 * something you look up rather than something you change.
 *
 * The page holds no mutation of its own, which is the point rather than an
 * omission. `repos.byId` is a `protectedProcedure`, and every procedure that
 * writes a repository is `adminProcedure`, so a button here would be a control
 * that fails on click. What the reader can do — follow the repository, follow a
 * project, read the README — needs no permission at all.
 *
 * The linked projects are the reason this page exists at all. The list shows a
 * count, which answers "has an admin published this yet" only as a number; here
 * the count has names, statuses and types, and a repository nobody has
 * published says so in a sentence rather than in a zero.
 */
export function ConsoleRepoDetail({ id }: { id: string }) {
  const formats = useFormats()
  const format = useFormatter()
  const t = useTranslations("RepoDetail")
  const consoleT = useTranslations("Console")
  const common = useTranslations("Common")
  const trendsT = useTranslations("ProjectDetail")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()

  const { data, isPending, isError } = useQuery(
    trpc.repos.byId.queryOptions({ id })
  )

  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  // A repository is deleted from under a stale link, and from a mistyped id, in
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
            <LocaleLink href="/console/repos">
              <IconArrowLeft />
              {t("backToRepos")}
            </LocaleLink>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const number = (value: number | null | undefined) =>
    value == null ? common("none") : format.number(value)

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

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <LocaleLink href="/console/repos">{consoleT("title")}</LocaleLink>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{data.fullName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <ProjectLogo
              name={data.name}
              logo={data.iconUrl}
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
                {data.archived ? (
                  <Badge variant="outline">{t("archived")}</Badge>
                ) : null}
                <Badge variant="secondary">{t("readOnly")}</Badge>
              </div>
              <CardDescription>
                <ExternalLink href={data.repoUrl}>
                  {data.owner}/{data.name}
                </ExternalLink>
              </CardDescription>
              <CardDescription>{t("readOnlyDescription")}</CardDescription>
              {data.homepage ? (
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <ExternalLink href={data.homepage}>
                    {t("homepage")}
                  </ExternalLink>
                </div>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          {data.description ? (
            <DescriptionPair
              description={data.description}
              descriptionZh={data.descriptionZh}
            />
          ) : null}

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
            <Field label={t("field.pullRequests")}>
              {number(data.pullRequestsCount)}
            </Field>
            <Field label={t("field.releases")}>
              {number(data.releasesCount)}
            </Field>
            <Field label={t("field.mentionable")}>
              {number(data.mentionableUsersCount)}
            </Field>
            <Field label={t("field.license")}>
              {data.licenseSpdxId || common("none")}
            </Field>
            <Field label={t("field.defaultBranch")}>
              {data.defaultBranch || common("none")}
            </Field>
            <Field label={t("field.lastCommit")}>
              {formats.relative(data.lastCommit)}
            </Field>
            <Field label={t("field.pushed")}>
              {formats.relative(data.pushedAt)}
            </Field>
            <Field label={t("field.repoCreated")}>
              {formats.dateTime(data.createdAt)}
            </Field>
            <Field label={t("field.added")}>
              {formats.dateTime(data.addedAt)}
            </Field>
            <Field label={t("field.updated")}>
              {data.updatedAt
                ? formats.dateTime(data.updatedAt)
                : common("none")}
            </Field>
            <Field label={t("field.latestRelease")}>
              {data.latestReleaseUrl ? (
                <ExternalLink href={data.latestReleaseUrl}>
                  {data.latestReleaseName || data.latestReleaseTagName}
                </ExternalLink>
              ) : (
                common("none")
              )}
            </Field>
          </FieldGrid>

          <div className="grid gap-4">
            <Field label={t("field.languages")}>
              <LabelRow items={data.languages ?? []} variant="outline" />
            </Field>
            <Field label={t("field.topics")}>
              <LabelRow items={data.topics ?? []} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("linkedProjects")}</CardTitle>
            <CardDescription>{t("linkedProjectsDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.project")}</TableHead>
                  <TableHead>{t("column.type")}</TableHead>
                  <TableHead>{t("column.status")}</TableHead>
                  <TableHead>{t("column.updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <span className="font-medium">{project.name}</span>
                      {project.description ? (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">
                          {project.description}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {typeLabel(project.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {statusLabel(project.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {project.updatedAt
                        ? formats.relative(project.updatedAt)
                        : common("none")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProjectTrends
        bars={data.trends.bars}
        weeks={data.trends.weeks}
        periods={data.trends.periods}
      />

      <ReadmeViewer
        readmeContent={data.readmeContent}
        readmeContentZh={data.readmeContentZh}
      />

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
                  <TableHead>{trendsT("trendMonthly")}</TableHead>
                  <TableHead>{t("field.stars")}</TableHead>
                  <TableHead>{t("historyNewStars")}</TableHead>
                  <TableHead>{t("field.contributors")}</TableHead>
                  <TableHead>{t("field.pullRequests")}</TableHead>
                  <TableHead>{t("field.releases")}</TableHead>
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
    </div>
  )
}
