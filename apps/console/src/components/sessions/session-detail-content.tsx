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
import { useTRPC } from "@/lib/trpc/client"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useFormats } from "@/lib/i18n/format"
import { LocaleLink, useLocaleRouter } from "@/i18n/navigation"

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
 * One session, with the account it belongs to and that account's other sessions.
 *
 * The sibling list is the reason this page exists. "Is this person signed in
 * anywhere else?" cannot be answered from a paginated list of sessions — the
 * other sessions are on another page — so the page fetches all of them and marks
 * which one is being read. Without that, the table above would answer a different
 * question: "which sessions exist", rather than "which devices this account is
 * currently on".
 *
 * Revoking here acts on the whole account, and says so. A page reached from one
 * session in particular is the natural place to ask for the broad action, and a
 * control that silently acted on four other rows would be the worst version of
 * it.
 */
export function SessionDetail({ id }: { id: string }) {
  const formats = useFormats()
  const t = useTranslations("SessionDetail")
  const common = useTranslations("Common")
  const roleLabel = useEnumLabel("Role")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useLocaleRouter()

  const { data, isPending, error } = useQuery(
    trpc.sessions.byId.queryOptions({ id })
  )

  const revoke = useMutation(
    trpc.sessions.revoke.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.allForUser
            ? t("signedOutEverywhere", {
                name: data?.user.name ?? data?.user.email ?? "",
                count: result.revokedCount,
              })
            : t("revoked")
        )
        // This session is one of the ones removed, so the page is about to
        // render a row the server has no longer heard of. Sending the reader
        // back to the list is the only outcome that does not look broken.
        void queryClient.invalidateQueries({
          queryKey: trpc.sessions.list.queryKey(),
        })
        router.push("/dashboard/sessions")
      },
      onError: (mutationError) => {
        toast.error(t("revokeFailed"), { description: mutationError.message })
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

  const accountName = data.user.name ?? data.user.email ?? data.user.id
  // Revoking this very session leaves nothing to render: the row the page is
  // about is the row that gets deleted, so the detail page ends rather than
  // showing a shell for something that no longer exists.
  const revokingSelf = revoke.isPending

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LocaleLink
          href="/dashboard/sessions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <IconChevronLeft className="size-4" />
          {t("backToSessions")}
        </LocaleLink>
        {!data.expired ? (
          <Button
            variant="outline"
            size="sm"
            disabled={revokingSelf}
            onClick={() =>
              revoke.mutate({ id: data.id, allForUser: true })
            }
          >
            {revokingSelf ? <Spinner /> : null}
            {t("revokeEverywhere")}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("session")}</CardTitle>
            <CardDescription>{t("sessionDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("field.id")}>
              <code className="text-xs">{data.id}</code>
            </Field>
            <Field label={t("field.ip")}>
              {data.ipAddress ?? common("none")}
            </Field>
            <Field label={t("field.state")}>
              <Badge
                variant="outline"
                className={
                  data.expired
                    ? "border-muted-foreground/30 text-muted-foreground"
                    : "border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                }
              >
                {data.expired ? common("no") : common("yes")}
              </Badge>
            </Field>
            <Field label={t("field.created")}>
              {formats.dateTime(data.createdAt)}
            </Field>
            <Field label={t("field.updated")}>
              {formats.dateTime(data.updatedAt)}
            </Field>
            <Field label={t("field.expires")}>
              {formats.dateTime(data.expiresAt)}
            </Field>
            {/* How long is left, not when it expires: the expiry timestamp is
                absolute and a reader has to do the subtraction themselves,
                while this is the question actually being asked. */}
            <Field label={t("field.remaining")}>
              {data.expired ? common("never") : formats.duration(data.expiresAt.getTime() - Date.now())}
            </Field>
            <Field label={t("field.userAgent")}>
              {data.userAgent ?? common("none")}
            </Field>
            <Field label={t("field.activeOrganization")}>
              {data.activeOrganizationId ?? t("unused")}
            </Field>
            <Field label={t("field.impersonatedBy")}>
              {data.impersonatedBy ?? t("unused")}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("account")}</CardTitle>
            <CardDescription>{t("accountDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("field.name")}>
              <LocaleLink
                className="underline-offset-4 hover:underline"
                href={`/dashboard/users/${data.user.id}`}
              >
                {accountName}
              </LocaleLink>
            </Field>
            <Field label={t("field.email")}>
              {data.user.email ?? common("none")}
            </Field>
            <Field label={t("field.phone")}>
              {data.user.phoneNumber ?? common("none")}
            </Field>
            <Field label={t("field.role")}>
              <Badge variant="outline">{roleLabel(data.user.role ?? "user")}</Badge>
            </Field>
            <Field label={t("field.banned")}>
              {data.user.banned ? common("yes") : common("no")}
            </Field>
            <Field label={t("field.submissions")}>
              {data.user.repoCount}
            </Field>
            <Field label={t("field.joined")}>
              {formats.dateTime(data.user.createdAt)}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="grid gap-1">
            <CardTitle>{t("otherSessions")}</CardTitle>
            <CardDescription>{t("otherSessionsDescription")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {data.siblings.length === 1 ? (
            /* One sibling row is the current session, so "no other sessions"
                reads better than a table of the one row you are already on. */
            <p className="text-sm text-muted-foreground">
              {t("noOtherSessions")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("column.ip")}</TableHead>
                  <TableHead>{t("column.created")}</TableHead>
                  <TableHead>{t("column.expires")}</TableHead>
                  <TableHead>{t("column.state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.siblings.map((sibling) => {
                  const isCurrent = sibling.id === data.id
                  return (
                    <TableRow key={sibling.id}>
                      <TableCell>
                        {sibling.ipAddress ?? common("none")}
                        {isCurrent ? (
                          <Badge variant="secondary" className="ml-2">
                            {t("thisSession")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formats.relative(sibling.createdAt)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formats.relative(sibling.expiresAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            sibling.expired
                              ? "border-muted-foreground/30 text-muted-foreground"
                              : "border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                          }
                        >
                          {sibling.expired ? common("no") : common("yes")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}