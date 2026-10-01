"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
import { Badge } from "@workspace/ui/components/badge"
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
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { IconChevronLeft, IconExternalLink } from "@tabler/icons-react"
import { AuthorActions } from "@/components/authors/author-card"
import { LocaleLink } from "@/i18n/navigation"
import { useTRPC } from "@/lib/trpc/client"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"

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
 * One author, with the projects credited to them.
 *
 * The list shows a name and a follower count and nothing else, which answers
 * "is this profile complete" and not "what does this person own". An author is
 * derived from the owner of a curated repository, so the same person can be
 * credited on several projects across several repositories, and only the join
 * tells you which — which is what an operator deciding whether to refresh a
 * profile actually wants to see before spending a GraphQL request on it.
 *
 * The refresh and edit controls are the shared `AuthorActions` rather than a
 * second copy: the same two operations exist on the author list, and two
 * implementations of "refresh this profile" would eventually stop agreeing about
 * which fields count as complete.
 */
export function AuthorDetail({ username }: { username: string }) {
  const formats = useFormats()
  const format = useFormatter()
  const t = useTranslations("AuthorDetail")
  const common = useTranslations("Common")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const { data, isPending, isError } = useQuery(
    trpc.authors.byId.queryOptions({ username })
  )

  // Both of these write columns the detail page reads, so the detail query is
  // what has to be invalidated — refetching the list alone would leave this page
  // showing the value the operator just replaced.
  const onAuthorChanged = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.authors.byId.queryKey({ username }),
    })
  }, [queryClient, trpc.authors.byId, username])

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
      </Card>
    )
  }

  const number = (value: number | null | undefined) =>
    value == null ? common("none") : format.number(value)

  return (
    <div className="flex flex-col gap-4">
      <LocaleLink
        href="/dashboard/authors"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <IconChevronLeft className="size-4" />
        {t("backToAuthors")}
      </LocaleLink>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start gap-4">
            <Avatar className="size-14">
              <AvatarImage src={data.avatar ?? data.avatarUrl ?? undefined} />
              <AvatarFallback>{data.username.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">
                  {data.name || data.username}
                </CardTitle>
                {data.verified ? (
                  <Badge variant="outline">{t("field.verified")}</Badge>
                ) : null}
                <Badge variant="secondary">{statusLabel(data.status)}</Badge>
              </div>
              <CardDescription>
                <ExternalLink href={`https://github.com/${data.username}`}>
                  @{data.username}
                </ExternalLink>
              </CardDescription>
              {data.bio ? (
                <p className="max-w-2xl text-sm">{data.bio}</p>
              ) : (
                <CardDescription>{common("none")}</CardDescription>
              )}
            </div>
            <AuthorActions
              author={{
                username: data.username,
                name: data.name,
                bio: data.bio,
                homepage: data.homepage,
                twitter: data.twitter,
                linkedin: data.linkedin,
                github: data.github,
                avatar: data.avatar,
                avatarUrl: data.avatarUrl,
                followers: data.followers,
                verified: data.verified,
                npmUsername: data.npmUsername,
                npmPackageCount: data.npmPackageCount,
              }}
              onChanged={onAuthorChanged}
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("field.username")}>@{data.username}</Field>
            <Field label={t("field.name")}>
              {data.name || common("none")}
            </Field>
            <Field label={t("field.followers")}>
              {/* A null follower count is the signal the author list leads with:
                  nothing has ever fetched this profile, so the number is absent
                  rather than zero. */}
              {data.followers == null ? (
                common("none")
              ) : (
                format.number(data.followers)
              )}
            </Field>
            <Field label={t("field.npmUsername")}>
              {data.npmUsername ? (
                <ExternalLink
                  href={`https://www.npmjs.com/~${data.npmUsername}`}
                >
                  npm:~{data.npmUsername}
                </ExternalLink>
              ) : (
                common("none")
              )}
            </Field>
            <Field label={t("field.npmPackages")}>
              {number(data.npmPackageCount)}
            </Field>
            <Field label={t("field.updated")}>
              {formats.relative(data.updatedAt)}
            </Field>
            {data.homepage ? (
              <Field label={t("field.homepage")}>
                <ExternalLink href={data.homepage}>
                  {data.homepage}
                </ExternalLink>
              </Field>
            ) : null}
            {data.twitter ? (
              <Field label={t("field.twitter")}>
                <ExternalLink href={`https://x.com/${data.twitter}`}>
                  @{data.twitter}
                </ExternalLink>
              </Field>
            ) : null}
            {data.linkedin ? (
              <Field label={t("field.linkedin")}>
                <ExternalLink href={`https://www.linkedin.com/in/${data.linkedin}`}>
                  {data.linkedin}
                </ExternalLink>
              </Field>
            ) : null}
          </dl>

          {/* The raw blob, on its own card rather than dumped into the grid:
              it is whatever the last refresh stored, so it has no fixed shape
              and cannot be given columns. */}
          <Card>
            <CardHeader>
              <div className="grid gap-1">
                <CardTitle>{t("metadata")}</CardTitle>
                <CardDescription>{t("metadataDescription")}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {data.metadata && Object.keys(data.metadata).length > 0 ? (
                <pre className="max-h-64 overflow-auto text-xs">
                  {JSON.stringify(data.metadata, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("noMetadata")}
                </p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("projects")}</CardTitle>
            <CardDescription>{t("projectsDescription")}</CardDescription>
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
                  <TableHead className="text-right">
                    {t("column.stars")}
                  </TableHead>
                  <TableHead>{t("column.updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
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
                      <Badge variant="outline">{typeLabel(project.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {statusLabel(project.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {number(project.stars)}
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
    </div>
  )
}