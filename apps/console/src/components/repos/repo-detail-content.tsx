"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { monthOfPeriod } from "@/lib/github/snapshot-dates"
import { Badge } from "@workspace/ui/components/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  IconArrowLeft,
  IconChevronLeft,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react"
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
import { RepoEditDialog } from "@/components/repos/repo-edit-dialog"
import { RepoDeleteDialog } from "@/components/repos/repo-delete-dialog"

/** How many months of star history the table shows. */
const MONTH_LIMIT = 24

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
 * One repository, as an operator reads it.
 *
 * Same data as the reader's repository page, plus the three things that only an
 * operator can do — edit, refresh, delete — and the two columns that make
 * multi-submission legible: who asked for this, and what the platform has done
 * about it.
 *
 * The submitters table is the part that changes with several accounts. It shows
 * the *public* half of each submission, which is identical for everyone, and it
 * withholds the private half from anyone who is not already entitled to it: the
 * note and the disposition of an account are readable on that account's own user
 * page and nowhere else. Nothing is filtered out here — the rows simply do not
 * carry those columns, so there is no code path that could leak them.
 *
 * The reader's own submission is editable right on this page, because the common
 * reaction to "I submitted this weeks ago and nothing happened" is to come back
 * to the repository and set a reminder. Writing `repos.updateOwnSubmission` sends
 * no user id: the server takes the account from the session, so this control
 * cannot be pointed at somebody else's row even by a modified request.
 */
export function RepoDetail({ id }: { id: string }) {
  const formats = useFormats()
  const format = useFormatter()
  const t = useTranslations("RepoDetail")
  const reposT = useTranslations("Repos")
  const navT = useTranslations("Nav")
  const common = useTranslations("Common")
  const trendsT = useTranslations("ProjectDetail")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const sourceLabel = useEnumLabel("Source")
  const userRepoStatusLabel = useEnumLabel("UserRepoStatus")
  const platformLabel = useEnumLabel("PlatformStatus")
  const roleLabel = useEnumLabel("Role")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const { data, isPending, isError } = useQuery(
    trpc.repos.byId.queryOptions({ id })
  )

  const refresh = useMutation(
    trpc.repos.refresh.mutationOptions({
      onSuccess: (result) => {
        // The repository the refresh was for, not the row it returned: a partial
        // failure still refreshed something, and naming the empty string would
        // read as "Refreshed ." in a toast.
        if (result.ok) {
          toast.success(
            reposT("refreshSucceeded", {
              name: data?.fullName ?? id,
            })
          )
        } else {
          toast.warning(reposT("refreshPartial"), {
            description: reposT("refreshFailedSteps", {
              steps: result.failed.join(", "),
            }),
          })
        }
        void queryClient.invalidateQueries({
          queryKey: trpc.repos.byId.queryKey({ id }),
        })
      },
      onError: (error) => {
        toast.error(reposT("refreshFailed"), { description: error.message })
      },
    })
  )

  const updateOwn = useMutation(
    trpc.repos.updateOwnSubmission.mutationOptions({
      onSuccess: () => {
        toast.success(t("submissionSaved"))
        void queryClient.invalidateQueries({
          queryKey: trpc.repos.byId.queryKey({ id }),
        })
      },
      onError: (error) => {
        toast.error(t("submissionSaveFailed"), { description: error.message })
      },
    })
  )


  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>{t("notFoundDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <LocaleLink href="/dashboard/repos">
              <IconArrowLeft />
              {reposT("title")}
            </LocaleLink>
          </Button>
        </CardContent>
      </Card>
    )
  }


  const number = (value: number | null | undefined) =>
    value == null ? common("none") : format.number(value)

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LocaleLink
          href="/dashboard/repos"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <IconChevronLeft className="size-4" />
          {reposT("title")}
        </LocaleLink>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate({ id })}
          >
            {refresh.isPending ? <Spinner /> : <IconRefresh />}
            {reposT("refreshRow", { name: data.fullName })}
          </Button>
          <RepoEditDialog
            repo={{
              id: data.id,
              fullName: data.fullName,
              description: data.description,
              descriptionZh: data.descriptionZh,
              homepage: data.homepage,
              iconUrl: data.iconUrl,
              overrideDescription: data.overrideDescription,
              overrideHomepage: data.overrideHomepage,
            }}
          />
          <RepoDeleteDialog
            repo={{
              id: data.id,
              fullName: data.fullName,
              projectCount: data.projects.length,
            }}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <ProjectLogo
              name={data.name}
              logo={data.iconUrl}
              avatar={githubAvatarUrl(data.owner, {
                ownerId: data.ownerId,
                size: 112,
              })}
              iconUrl={data.iconUrl}
              className="size-14"
            />
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">{data.fullName}</CardTitle>
                {data.archived ? (
                  <Badge variant="outline">{t("archived")}</Badge>
                ) : null}
              </div>
              <CardDescription>
                <ExternalLink href={data.repoUrl}>
                  {navT("repos")}
                </ExternalLink>
              </CardDescription>
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
            <CardTitle>{t("platformState")}</CardTitle>
            <CardDescription>{t("platformStateDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Read off the reader's own row when there is one, because that is
              the copy the server keeps in sync for everybody; the badge below
              then agrees with every other submitter's page by construction. */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                data.ownSubmission?.platformStatus === "archived"
                  ? "border-muted-foreground/30 text-muted-foreground"
                  : "border-sky-400/40 text-sky-700 dark:text-sky-300"
              }
            >
              {platformLabel(
                data.ownSubmission?.platformStatus ?? "tracked"
              )}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {data.submitterCount > 0
                ? t("submitterCount", { count: data.submitterCount })
                : t("noSubmitters")}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("yourSubmission")}</CardTitle>
            <CardDescription>{t("yourSubmissionDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.ownSubmission ? (
            <SubmissionEditor
              repoId={data.id}
              initial={{
                status: data.ownSubmission.status,
                note: data.ownSubmission.note,
                pinned: data.ownSubmission.pinned,
              }}
              submittedAt={data.ownSubmission.submittedAt}
              lastViewedAt={data.ownSubmission.lastViewedAt}
              pending={updateOwn.isPending}
              onSave={(values) => updateOwn.mutate({ repoId: id, ...values })}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("notSubmitted")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("submitters")}</CardTitle>
            <CardDescription>{t("submittersDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.submitters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSubmitters")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.submitter")}</TableHead>
                  <TableHead>{t("column.submittedVia")}</TableHead>
                  <TableHead>{t("column.platformState")}</TableHead>
                  <TableHead>{t("column.theirStatus")}</TableHead>
                  <TableHead>{t("column.submittedAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.submitters.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell>
                      <LocaleLink
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/dashboard/users/${row.userId}`}
                      >
                        {row.name || row.email}
                      </LocaleLink>
                      <span className="block text-xs text-muted-foreground">
                        {roleLabel(row.role ?? "user")}
                        {row.email ? ` · ${row.email}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {sourceLabel(row.source)}
                      </Badge>
                    </TableCell>
                    {/* Both status columns are shown because they answer
                        different questions and can disagree: the platform may
                        have published this repository while its submitter set it
                        aside, and "why is this archived?" is asked by somebody
                        looking at the left column and answered by the right one. */}
                    <TableCell>
                      <Badge variant="outline">
                        {platformLabel(
                          data.ownSubmission?.platformStatus ?? "tracked"
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {userRepoStatusLabel(row.status)}
                      </Badge>
                      {row.pinned ? (
                        <Badge variant="outline" className="ml-1">
                          {t("column.pinned")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.submittedAt)}
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
                      {/* By id, not by slug: every other dashboard link into a
                          project uses the id, and `projects.byId` is what reads
                          it. A slug link here would 404 on a project whose slug
                          has drifted from its name. */}
                      <LocaleLink
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/dashboard/projects/${project.id}`}
                      >
                        {project.name}
                      </LocaleLink>
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

/**
 * The reader's own disposition of this repository.
 *
 * Local state seeded from the server row, so the controls show what is stored
 * rather than what was last typed — reopening the page shows the saved note, not
 * a draft that was never submitted.
 *
 * Every field is sent on save rather than on change: `repos.updateOwnSubmission`
 * is a partial write where an absent field is left alone, and sending the whole
 * set is what makes "save" mean "this is the state I want" rather than "apply the
 * three things I happened to touch".
 */
function SubmissionEditor({
  repoId,
  initial,
  submittedAt,
  lastViewedAt,
  pending,
  onSave,
}: {
  repoId: string
  initial: {
    status: "active" | "ignored" | "archived"
    note: string | null
    pinned: boolean
  }
  submittedAt: Date
  lastViewedAt: Date | null
  pending: boolean
  onSave: (values: {
    status: "active" | "ignored" | "archived"
    note: string | null
    pinned: boolean
  }) => void
}) {
  const t = useTranslations("RepoDetail")
  const common = useTranslations("Common")
  const statusLabel = useEnumLabel("UserRepoStatus")
  const formats = useFormats()
  const [status, setStatus] = React.useState(initial.status)
  const [note, setNote] = React.useState(initial.note ?? "")
  const [pinned, setPinned] = React.useState(initial.pinned)

  const dirty =
    status !== initial.status ||
    pinned !== initial.pinned ||
    note !== (initial.note ?? "")

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">
            {t("column.submittedAt")}
          </span>
          <span className="text-sm">{formats.dateTime(submittedAt)}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">
            {t("column.lastViewed")}
          </span>
          <span className="text-sm">
            {lastViewedAt ? formats.relative(lastViewedAt) : common("never")}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor={`status-${repoId}`}>{t("yourStatus")}</Label>
          <NativeSelect
            id={`status-${repoId}`}
            value={status}
            onChange={(event) =>
              setStatus(
                event.target.value as "active" | "ignored" | "archived"
              )
            }
          >
            {(["active", "ignored", "archived"] as const).map((value) => (
              <NativeSelectOption key={value} value={value}>
                {statusLabel(value)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`pinned-${repoId}`}
            checked={pinned}
            onCheckedChange={setPinned}
          />
          <Label htmlFor={`pinned-${repoId}`}>{t("pin")}</Label>
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor={`note-${repoId}`}>{t("note")}</Label>
        <Textarea
          id={`note-${repoId}`}
          value={note}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t("notePlaceholder")}
        />
        <span className="text-xs text-muted-foreground">
          {t("noteVisibility")}
        </span>
      </div>

      <div>
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            onSave({
              status,
              note: note.trim() === "" ? null : note,
              pinned,
            })
          }
        >
          {pending ? <Spinner /> : null}
          {t("saveSubmission")}
        </Button>
      </div>
    </div>
  )
}