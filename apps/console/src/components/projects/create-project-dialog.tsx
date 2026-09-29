"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { IconCirclePlusFilled } from "@tabler/icons-react"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"
import { useLocaleRouter } from "@/i18n/navigation"
import { parseGithubRepoUrl } from "@/lib/github/repo-url"

// The values are the wire format; the labels are translated, so the list is
// values only and the label comes from the `Type` namespace.
const TYPES = ["application", "skill", "client", "server", "persona"] as const

/**
 * The create-project form.
 *
 * The URL is the only required field and the type defaults to `application`,
 * matching the reference endpoint: an omitted type must not quietly publish a
 * repository as a skill, because a skill project is synced from its SKILL.md
 * and everything else is not.
 *
 * `trigger` replaces the default button, so the same form can be opened from
 * the sidebar's Quick Create without a second copy of the dialog.
 */
export function CreateProjectDialog({
  trigger,
}: {
  trigger?: React.ReactNode
}) {
  const t = useTranslations("CreateProject")
  const typeLabel = useEnumLabel("Type")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useLocaleRouter()

  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const [type, setType] = React.useState<string>("application")

  const trimmed = url.trim()

  // The preview is a server question — it has to know whether this repository
  // is already curated — so it runs against the endpoint rather than the local
  // parser. The pause matters more here than for a filter: each keystroke would
  // otherwise be a database round trip and a cache entry per prefix.
  const preview = useQuery({
    ...trpc.projects.parseUrl.queryOptions({ url: trimmed || " " }),
    enabled: open && trimmed.length > 0,
    staleTime: 30_000,
  })
  const previewData = preview.data ?? null
  // Reuse the exact same parser the server uses, so the local check accepts
  // every valid shape (full https URL, ssh remote, bare owner/repo, `.git`
  // suffix, trailing paths) and never shows the error for a URL the server
  // would happily accept.
  const looksValid = parseGithubRepoUrl(trimmed) !== null

  const reset = () => {
    setUrl("")
    setType("application")
  }

  const create = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries({
          queryKey: trpc.projects.list.queryKey(),
        })

        if (result.status === "existing") {
          toast.info(t("alreadyExists", { slug: result.project.slug }))
        } else {
          const synced = [
            result.readme.synced ? t("readmeFetched") : null,
            result.skills && !result.skills.empty
              ? t("skillsCount", { count: result.skills.count })
              : null,
          ].filter(Boolean)

          toast.success(t("created", { slug: result.project.slug }), {
            description:
              synced.length > 0 ? synced.join(" · ") : t("queuedForSync"),
          })
        }

        setOpen(false)
        reset()

        // Straight to what was just created. A project exists to be filled in —
        // description, status, tags — and every one of those lives on its own
        // page, so closing the dialog onto the list throws the operator back to
        // the row they were already looking at. An existing project navigates
        // too: the request was the same one, and the page is where its state
        // can be read.
        router.push(`/dashboard/projects/${result.project.id}`)
      },
      onError: (error) => {
        toast.error(t("couldNotCreate"), {
          description: error.message,
        })
      },
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <IconCirclePlusFilled />
            {t("trigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!trimmed || create.isPending) return
            create.mutate({ url: trimmed, type: type as never })
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="project-url">{t("urlLabel")}</Label>
            <Input
              id="project-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t("urlPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={url.length > 0 && !looksValid}
            />
            {url.length > 0 && !looksValid ? (
              <p className="text-sm text-destructive">{t("urlError")}</p>
            ) : null}
            {/* Where the URL actually points, and whether it is already
                curated. Creation is idempotent but only says so after the
                round trip and the GitHub fetch, so this is what lets an
                operator change their mind before clicking. */}
            {looksValid && !preview.isPending ? (
              previewData ? (
                <p className="text-sm text-muted-foreground">
                  {previewData.exists
                    ? t("previewExisting", {
                        fullName: `${previewData.owner}/${previewData.name}`,
                      })
                    : t("previewNew", {
                        fullName: `${previewData.owner}/${previewData.name}`,
                      })}
                </p>
              ) : null
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="project-type">{t("typeLabel")}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="project-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {typeLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!trimmed || create.isPending}
              className="gap-2"
            >
              {create.isPending ? <Spinner /> : null}
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
