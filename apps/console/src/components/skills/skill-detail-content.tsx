"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
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
import { IconArrowLeft, IconCloudUpload } from "@tabler/icons-react"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { useFormats } from "@/lib/i18n/format"
import { LocaleLink } from "@/i18n/navigation"
import { SyncStatusBadge } from "@/components/status-badge"
import { ReadmeViewer } from "@/components/projects/readme-viewer"

/** Renders one label/value row, or the dash the list pages use for "none". */
function Field({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  )
}

/**
 * One skill, in full.
 *
 * The list shows delivery state, because that is what an operator scans for.
 * What it cannot show is the payload itself: whether the translation is a real
 * translation of *this* skill or a copy of the original, and whether the stored
 * README is the one in the repository. A skill is a delivered document, so its
 * content is the thing worth reading, and it only gets a page of its own once
 * it is in that document.
 */
export function SkillDetail({ id }: { id: string }) {
  const t = useTranslations("SkillDetail")
  const formats = useFormats()
  const common = useTranslations("Common")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const { data, isPending } = useQuery(trpc.skills.byId.queryOptions({ id }))

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
          queryKey: trpc.skills.byId.queryKey({ id }),
        })
        void queryClient.invalidateQueries({
          queryKey: trpc.skills.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("pushFailed"), { description: error.message })
      },
    })
  )

  if (isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <LocaleLink href="/dashboard/skills">
              <IconArrowLeft />
              {t("backToList")}
            </LocaleLink>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { skill, project, repo } = data
  const fullName = `${repo.owner}/${repo.name}`

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-1">
              <CardTitle className="text-xl">{skill.name}</CardTitle>
              <CardDescription>
                <code>{skill.skillDir}</code>{" · "}
                <LocaleLink
                  className="underline underline-offset-4"
                  href={`/dashboard/projects/${project.id}`}
                >
                  {project.owner}/{project.name}
                </LocaleLink>
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" asChild>
                <LocaleLink href="/dashboard/skills">
                  <IconArrowLeft />
                  {t("backToList")}
                </LocaleLink>
              </Button>
              <Button
                variant="outline"
                disabled={push.isPending}
                onClick={() =>
                  push.mutate({
                    projectId: skill.projectId,
                    skillDir: skill.skillDir,
                  })
                }
              >
                {push.isPending ? <Spinner /> : <IconCloudUpload />}
                {t("push")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={t("field.repository")}
              value={
                repo.homepage ? (
                  <a
                    className="underline underline-offset-4"
                    href={repo.homepage}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {fullName}
                  </a>
                ) : (
                  fullName
                )
              }
            />
            <Field
              label={t("field.projectStatus")}
              value={
                <span className="flex items-center gap-2">
                  <SyncStatusBadge status={project.status} />
                  {statusLabel(project.status)}
                </span>
              }
            />
            <Field label={t("field.version")} value={skill.version ?? common("none")} />
            <Field
              label={t("field.syncedToWeb")}
              value={
                skill.syncedToWebAt
                  ? formats.relative(skill.syncedToWebAt)
                  : common("never")
              }
            />
            <Field
              label={t("field.lastAttempt")}
              value={
                skill.lastSyncAttemptAt
                  ? formats.relative(skill.lastSyncAttemptAt)
                  : common("none")
              }
            />
            <Field
              label={t("field.contentHash")}
              value={
                skill.contentHash ? (
                  <code className="text-xs">{skill.contentHash}</code>
                ) : (
                  common("none")
                )
              }
            />
          </dl>

          {skill.lastSyncError ? (
            <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {skill.lastSyncError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("descriptionTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="EN" value={skill.description || common("none")} />
          <Field
            label="中文"
            value={skill.descriptionZh || t("notTranslated")}
          />
        </CardContent>
      </Card>

      {/* The stored README is the payload the webhook actually sends, rendered
          through the same viewer the project page uses so the sanitising and
          the link rewriting are identical in both places. */}
      <ReadmeViewer
        readmeContent={skill.readme}
        readmeContentZh={skill.readmeZh}
        fallback={t("noReadme")}
      />
    </div>
  )
}
