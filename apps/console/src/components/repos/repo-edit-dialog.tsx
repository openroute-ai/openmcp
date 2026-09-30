"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
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
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Textarea } from "@workspace/ui/components/textarea"
import { IconPencil, IconPlus } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"

/** The fields of a repository this editor owns. */
type RepoEditable = {
  id: string
  fullName: string
  description: string | null
  descriptionZh: string | null
  homepage: string | null
  iconUrl: string | null
  /** Whether a human has taken the field over from GitHub. */
  overrideDescription: boolean | null
  overrideHomepage: boolean | null
}

/** Server rejections, which are codes the interface translates. */
const REPO_ERRORS = {
  "repos.create.unparseable": "createUnparseable",
  "repos.create.fetchFailed": "createFetchFailed",
} as const satisfies Record<string, string>

/**
 * Adds a repository by its GitHub reference.
 *
 * The operator types a URL, an SSH remote or a bare `owner/name` and the server
 * reads the metadata from GitHub, because a repository row cannot be built by
 * hand: `pushed_at` and `created_at` are not nullable and every counter on the
 * list would be blank. So this is really "start tracking this repository" —
 * it fetches, and it says whether the repository was new so that adding one
 * that was already tracked does not read as a fresh discovery.
 */
export function RepoCreateDialog() {
  const t = useTranslations("Repos")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [reference, setReference] = React.useState("")

  const create = useMutation(
    trpc.repos.create.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          result.created
            ? t("createSucceeded", { name: result.fullName })
            : t("createAlreadyTracked", { name: result.fullName })
        )
        setOpen(false)
        setReference("")
        void queryClient.invalidateQueries({
          queryKey: trpc.repos.list.queryKey(),
        })
      },
      onError: (error) => {
        const key = REPO_ERRORS[error.message as keyof typeof REPO_ERRORS]
        toast.error(t("createFailed"), {
          description: key ? t(key) : error.message,
        })
      },
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setReference("")
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <IconPlus />
          {t("create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!create.isPending && reference.trim() !== "") {
              create.mutate({ repository: reference.trim() })
            }
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="repo-reference">{t("createField")}</Label>
            <Input
              id="repo-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="https://github.com/owner/name"
              autoFocus
              required
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={create.isPending || reference.trim() === ""}
            >
              {create.isPending ? <Spinner /> : null}
              {t("createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Edits the fields a repository refresh would otherwise overwrite.
 *
 * The description and the homepage are GitHub's, so saving a change to either
 * marks it as hand-set and the daily sweep leaves it alone. The description
 * says so, because an editor that silently loses work on the next morning is
 * worse than not having one — an operator who did not know would file it as a
 * bug. The Chinese description and the icon are ours already, so they are
 * edited directly.
 */
export function RepoEditDialog({ repo }: { repo: RepoEditable }) {
  const t = useTranslations("Repos")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [description, setDescription] = React.useState(repo.description ?? "")
  const [descriptionZh, setDescriptionZh] = React.useState(
    repo.descriptionZh ?? ""
  )
  const [homepage, setHomepage] = React.useState(repo.homepage ?? "")
  const [iconUrl, setIconUrl] = React.useState(repo.iconUrl ?? "")
  // Released means "hand this back to GitHub on save". Only meaningful for a
  // field that is currently overridden, so it starts clear and the checkbox is
  // not rendered otherwise.
  const [releaseDescription, setReleaseDescription] = React.useState(false)
  const [releaseHomepage, setReleaseHomepage] = React.useState(false)

  // Re-seeded on open, so a saved edit does not reappear as a pending change
  // the next time the dialog is opened.
  const reset = React.useCallback(() => {
    setDescription(repo.description ?? "")
    setDescriptionZh(repo.descriptionZh ?? "")
    setHomepage(repo.homepage ?? "")
    setIconUrl(repo.iconUrl ?? "")
    setReleaseDescription(false)
    setReleaseHomepage(false)
  }, [repo])

  const update = useMutation(
    trpc.repos.update.mutationOptions({
      onSuccess: () => {
        toast.success(t("updateSucceeded", { name: repo.fullName }))
        setOpen(false)
        void queryClient.invalidateQueries({
          queryKey: trpc.repos.list.queryKey(),
        })
      },
      onError: (error) => {
        toast.error(t("updateFailed"), { description: error.message })
      },
    })
  )

  function save() {
    update.mutate({
      id: repo.id,
      // A released field sends no value at all: the flag alone is the change,
      // and the next sweep supplies GitHub's value. Sending the box's current
      // contents as well would write the old hand-set value one last time.
      ...(releaseDescription
        ? { overrideDescription: false }
        : {
            description: description.trim() === "" ? null : description.trim(),
          }),
      descriptionZh: descriptionZh.trim() === "" ? null : descriptionZh.trim(),
      // Validated as a URL on the server, so a blank clears it and anything
      // else has to be a real address rather than a typo that would render as
      // a dead link on the public site.
      ...(releaseHomepage
        ? { overrideHomepage: false }
        : {
            homepage: homepage.trim() === "" ? null : homepage.trim(),
          }),
      iconUrl: iconUrl.trim() === "" ? null : iconUrl.trim(),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("editRow", { name: repo.fullName })}
          title={t("editRow", { name: repo.fullName })}
        >
          <IconPencil />
          <span className="sr-only">
            {t("editRow", { name: repo.fullName })}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!update.isPending) save()
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("editTitle", { name: repo.fullName })}</DialogTitle>
            <DialogDescription>{t("editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="repo-description">{t("field.description")}</Label>
            <Textarea
              id="repo-description"
              rows={3}
              value={description}
              disabled={releaseDescription}
              onChange={(event) => setDescription(event.target.value)}
            />
            {repo.overrideDescription ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={releaseDescription}
                  onCheckedChange={(checked) =>
                    setReleaseDescription(checked === true)
                  }
                />
                {t("release")}
              </label>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repo-description-zh">
              {t("field.descriptionZh")}
            </Label>
            <Textarea
              id="repo-description-zh"
              rows={3}
              value={descriptionZh}
              onChange={(event) => setDescriptionZh(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repo-homepage">{t("field.homepage")}</Label>
            <Input
              id="repo-homepage"
              type="url"
              value={homepage}
              disabled={releaseHomepage}
              onChange={(event) => setHomepage(event.target.value)}
              placeholder="https://example.com"
            />
            {repo.overrideHomepage ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={releaseHomepage}
                  onCheckedChange={(checked) =>
                    setReleaseHomepage(checked === true)
                  }
                />
                {t("release")}
              </label>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="repo-icon">{t("field.iconUrl")}</Label>
            <Input
              id="repo-icon"
              type="url"
              value={iconUrl}
              onChange={(event) => setIconUrl(event.target.value)}
              placeholder="https://example.com/icon.png"
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Spinner /> : null}
              {t("updateSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
