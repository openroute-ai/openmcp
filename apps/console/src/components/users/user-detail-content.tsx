"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { IconChevronLeft } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { authClient } from "@/lib/auth-client"
import { useTRPC } from "@/lib/trpc/client"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { LocaleLink } from "@/i18n/navigation"

/**
 * A labelled value in a detail grid.
 *
 * Rendered as a definition list so the label and the value are marked up as
 * such rather than as a two-column table of text, which is what a table of
 * field/value pairs otherwise degrades into for a screen reader.
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

/**
 * One account, with everything that hangs off it.
 *
 * The three sections are shown together rather than behind tabs because they
 * explain each other: a session says whether this person is signed in right now,
 * a credential row says how they get in, and a submission says what they are
 * here for. Reading any one alone answers half the question.
 *
 * The submission table shows the platform's column and the account's own column
 * side by side, which is the distinction this page exists to make visible. The
 * platform state is a fact about the repository and is identical for every
 * submitter; the disposition and the note are this account's private opinion of
 * it, and no other account can read them.
 */
export function UserDetail({ id }: { id: string }) {
  const formats = useFormats()
  const t = useTranslations("UserDetail")
  const common = useTranslations("Common")
  const roleLabel = useEnumLabel("Role")
  const sourceLabel = useEnumLabel("Source")
  const statusLabel = useEnumLabel("UserRepoStatus")
  const platformLabel = useEnumLabel("PlatformStatus")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: authSession } = authClient.useSession()

  const { data, isPending, error } = useQuery(
    trpc.users.byId.queryOptions({ id })
  )

  const setRole = useMutation(
    trpc.users.setRole.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          t("roleChanged", {
            name: result.name ?? result.id,
            role: roleLabel(result.role ?? "user"),
          })
        )
        void queryClient.invalidateQueries({
          queryKey: trpc.users.byId.queryKey({ id }),
        })
      },
      onError: (mutationError) => {
        // Self-demotion comes back as a server key rather than prose, because
        // the server has to refuse it and the browser is the only place that can
        // turn that refusal into an explanation.
        toast.error(
          mutationError.message === "users.setRole.selfDemotion"
            ? t("selfDemotionRefused")
            : t("roleChangeFailed"),
          { description: mutationError.message }
        )
      },
    })
  )

  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>{t("notFoundDescription")}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const displayName = data.name ?? data.email ?? data.id
  // The signed-in account, so the page can refuse to offer the one action that
  // would lock the reader out. The server refuses it regardless; hiding it here
  // means nobody learns the rule by hitting it.
  const isSelf = authSession?.user?.id === data.id
  const toggleLabel = data.isAdmin ? t("demote") : t("promote")

  return (
    <div className="grid gap-4">
      <div>
        <LocaleLink
          href="/dashboard/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <IconChevronLeft className="size-4" />
          {t("backToUsers")}
        </LocaleLink>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <CardTitle>{displayName}</CardTitle>
              <CardDescription>{t("accountDescription")}</CardDescription>
            </div>
            {/* Not offered on your own account. The server refuses it either
                way, and a button that always fails is worse than no button:
                it teaches that the console has a dead end. */}
            {!isSelf ? (
              <Button
                variant="outline"
                size="sm"
                disabled={setRole.isPending}
                onClick={() =>
                  setRole.mutate({
                    id: data.id,
                    role: data.isAdmin ? "user" : "admin",
                  })
                }
              >
                {setRole.isPending ? <Spinner /> : null}
                {toggleLabel}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("field.id")}>
              <code className="text-xs">{data.id}</code>
            </Field>
            <Field label={t("field.name")}>{data.name ?? common("none")}</Field>
            <Field label={t("field.email")}>{data.email ?? common("none")}</Field>
            <Field label={t("field.emailVerified")}>
              {data.emailVerified ? common("yes") : common("no")}
            </Field>
            <Field label={t("field.phone")}>
              {data.phoneNumber ?? common("none")}
            </Field>
            <Field label={t("field.phoneVerified")}>
              {data.phoneNumberVerified ? common("yes") : common("no")}
            </Field>
            <Field label={t("field.role")}>
              <Badge variant="outline">{roleLabel(data.role ?? "user")}</Badge>
            </Field>
            <Field label={t("field.banned")}>
              {data.banned ? (
                <>
                  <Badge
                    variant="outline"
                    className="border-destructive/40 text-destructive"
                  >
                    {t("field.banned")}
                  </Badge>
                  {data.banReason ? (
                    <span className="block text-xs text-muted-foreground">
                      {data.banReason}
                    </span>
                  ) : null}
                </>
              ) : (
                common("no")
              )}
            </Field>
            {data.banExpires ? (
              <Field label={t("field.banExpires")}>
                {formats.dateTime(data.banExpires)}
              </Field>
            ) : null}
            {data.customerId ? (
              <Field label={t("field.customerId")}>
                <code className="text-xs">{data.customerId}</code>
              </Field>
            ) : null}
            <Field label={t("field.createdAt")}>
              {formats.dateTime(data.createdAt)}
            </Field>
            <Field label={t("field.updatedAt")}>
              {formats.dateTime(data.updatedAt)}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("sessions")}</CardTitle>
            <CardDescription>{t("sessionsDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSessions")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("field.ip")}</TableHead>
                  <TableHead>{t("field.userAgent")}</TableHead>
                  <TableHead>{t("field.created")}</TableHead>
                  <TableHead>{t("field.expires")}</TableHead>
                  <TableHead>{t("field.state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sessions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.ipAddress ?? common("none")}</TableCell>
                    <TableCell className="max-w-80">
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {row.userAgent ?? common("none")}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            row.expired
                              ? "border-muted-foreground/30 text-muted-foreground"
                              : "border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {row.expired ? t("sessionExpired") : t("sessionActive")}
                        </Badge>
                        <LocaleLink
                          className="text-xs underline-offset-4 hover:underline"
                          href={`/dashboard/sessions/${row.id}`}
                        >
                          {t("openSession")}
                        </LocaleLink>
                      </div>
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
            <CardTitle>{t("providers")}</CardTitle>
            <CardDescription>{t("providersDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noProviders")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("field.provider")}</TableHead>
                  <TableHead>{t("field.accountId")}</TableHead>
                  <TableHead>{t("field.createdAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.providerId}</TableCell>
                    {/* Whether a credential exists, never what it is: the column
                        holds a password hash or an OAuth token, and this page has
                        no use for either. The credential-provider account id is
                        not secret and is shown next to the method, because "GitHub"
                        alone does not say which GitHub account. */}
                    <TableCell className="max-w-80">
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.accountId ?? common("none")}
                      </span>
                      <span className="text-xs">
                        {row.hasPassword ? t("hasPassword") : t("noPassword")}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.createdAt)}
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
            <CardTitle>{t("submissions")}</CardTitle>
            <CardDescription>
              {t("submissionsDescription")}
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("yourRelationDescription")}
              </span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSubmissions")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.repo")}</TableHead>
                  <TableHead>{t("column.source")}</TableHead>
                  <TableHead>{t("column.platformState")}</TableHead>
                  <TableHead>{t("column.theirStatus")}</TableHead>
                  <TableHead>{t("column.submittedAt")}</TableHead>
                  <TableHead>{t("column.note")}</TableHead>
                  <TableHead>{t("column.lastViewed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.submissions.map((row) => (
                  <TableRow key={row.repoId}>
                    <TableCell>
                      <LocaleLink
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/dashboard/repos/${row.repoId}`}
                      >
                        {row.repo.owner}/{row.repo.name}
                      </LocaleLink>
                      {row.repo.description ? (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">
                          {row.repo.description}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{sourceLabel(row.source)}</Badge>
                    </TableCell>
                    <TableCell>
                      {/* The public half. Identical for every submitter,
                          because it describes the repository rather than the
                          person. */}
                      <Badge variant="outline">
                        {platformLabel(row.platformStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {/* The private half: this account's own disposition of
                          the repository, which no other account can read. */}
                      <Badge variant="outline">
                        {statusLabel(row.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formats.relative(row.submittedAt)}
                    </TableCell>
                    <TableCell className="max-w-64">
                      {row.note ? (
                        <span className="line-clamp-2 text-xs">
                          {row.note}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {common("none")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastViewedAt
                        ? formats.relative(row.lastViewedAt)
                        : common("never")}
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