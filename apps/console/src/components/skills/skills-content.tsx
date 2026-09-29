"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { IconCloudUpload } from "@tabler/icons-react"
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
import { Input } from "@workspace/ui/components/input"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { DataPagination } from "@/components/data-pagination"
import { LocaleLink } from "@/i18n/navigation"

type SkillStatus = "all" | "pending" | "synced" | "error"

/** Rows per page. Enough to scan a delivery backlog, few enough to stay a page. */
const PAGE_SIZE = 20

/**
 * How long typing pauses before the search is sent.
 *
 * The search runs on the server, so every keystroke would be a round trip and
 * a query cache entry per prefix.
 */
const SEARCH_DEBOUNCE_MS = 300

export function SkillsContent() {
  const formats = useFormats()
  const t = useTranslations("Skills")
  const common = useTranslations("Common")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<SkillStatus>("all")
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [settled, setSettled] = React.useState<{
    status: SkillStatus
    search: string
  }>({ status: "all", search: "" })

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  // A new filter or search starts at the first page: page five of the previous
  // result set is meaningless against a different one, and the request would
  // come back empty until the operator noticed.
  //
  // Adjusted during render rather than in an effect, because the page and the
  // filter are two halves of one value and an effect would paint the stale page
  // once before correcting it.
  if (status !== settled.status || search !== settled.search) {
    setSettled({ status, search })
    setPage(1)
  }

  const { data, isPending } = useQuery(
    trpc.skills.list.queryOptions({
      status,
      search,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
  )

  const skills = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // A skill that failed to deliver is a row an operator came to fix, so the
  // retry sits on the row. The delivery outcome is reported rather than thrown,
  // because a refused webhook is recorded on the skill, not raised at the
  // caller: the row's error column is where that answer belongs.
  const push = useMutation(
    trpc.skills.push.mutationOptions({
      onSuccess: (result) => {
        if (result.pushed) {
          toast.success(t("pushSucceeded", { name: result.skillDir }))
        } else {
          toast.error(t("pushRejected", { name: result.skillDir }), {
            description: result.summary,
          })
        }
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("pushFailed"), { description: error.message })
      },
    })
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <Tabs
            value={status}
            onValueChange={(value) => setStatus(value as SkillStatus)}
          >
            <TabsList>
              <TabsTrigger value="all">{t("tab.all")}</TabsTrigger>
              <TabsTrigger value="pending">{t("tab.pending")}</TabsTrigger>
              <TabsTrigger value="synced">{t("tab.synced")}</TabsTrigger>
              <TabsTrigger value="error">{t("tab.errors")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="max-w-sm"
        />
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("column.project")}</TableHead>
                <TableHead>{t("column.skill")}</TableHead>
                <TableHead>{t("column.translated")}</TableHead>
                <TableHead>{t("column.syncedToWeb")}</TableHead>
                <TableHead>{t("column.lastAttempt")}</TableHead>
                <TableHead>{t("column.error")}</TableHead>
                <TableHead className="w-28">{t("column.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <div className="font-medium">{skill.projectName}</div>
                    <div className="text-xs text-muted-foreground">
                      {skill.projectOwner}
                    </div>
                  </TableCell>
                  <TableCell>
                    {/* The name opens the skill: the list shows delivery state,
                        but the payload that was delivered is only on its own
                        page. */}
                    <LocaleLink
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/dashboard/skills/${skill.id}`}
                    >
                      {skill.name}
                    </LocaleLink>
                    <code className="block text-xs text-muted-foreground">
                      {skill.skillDir}
                    </code>
                  </TableCell>
                  <TableCell>
                    {skill.descriptionZh ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {common("yes")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {common("no")}
                      </span>
                    )}
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
                  <TableCell>
                    {/* Offered on a failed row and on one that has never been
                        delivered, because that is exactly the set the
                        push-skills task will sweep; on a healthy row it would
                        be a second copy of work the task already did. */}
                    {skill.lastSyncError || !skill.syncedToWebAt ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          push.isPending &&
                          push.variables?.skillDir === skill.skillDir
                        }
                        onClick={() =>
                          push.mutate({
                            projectId: skill.projectId,
                            skillDir: skill.skillDir,
                          })
                        }
                      >
                        {push.isPending &&
                        push.variables?.skillDir === skill.skillDir ? (
                          <Spinner />
                        ) : (
                          <IconCloudUpload />
                        )}
                        {t("push")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

            <DataPagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
