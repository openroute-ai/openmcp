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
import { IconTrash } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"

export type RepoDeleteTarget = {
  id: string
  fullName: string
  projectCount: number
}

/**
 * Confirms a repository deletion.
 *
 * The confirmation says what else goes with it, and a second click is required
 * when projects point at the repository. That is not friction for its own sake:
 * the foreign key cascades, so deleting a curated repository takes its projects,
 * their tags, their skills and their sync history with it, and only the
 * repository row can be fetched again. A repository with no projects deletes on
 * the first click, because that is a row nobody curated and the sweep would
 * otherwise keep paying for it.
 */
export function RepoDeleteDialog({ repo }: { repo: RepoDeleteTarget }) {
  const t = useTranslations("Repos")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [armed, setArmed] = React.useState(false)
  const isCascading = repo.projectCount > 0

  const remove = useMutation(
    trpc.repos.delete.mutationOptions({
      onSuccess: (result) => {
        toast.success(
          t("deleteSucceeded", {
            name: result.fullName,
            count: result.deletedProjects.length,
          })
        )
        setOpen(false)
        setArmed(false)
        void queryClient.invalidateQueries()
      },
      onError: (error) => {
        toast.error(t("deleteFailed"), { description: error.message })
      },
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Re-armed on every open: an acknowledgement has to be about the
        // deletion in front of you, not remembered from the last one.
        if (!next) setArmed(false)
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("deleteRow", { name: repo.fullName })}
          title={t("deleteRow", { name: repo.fullName })}
        >
          <IconTrash />
          <span className="sr-only">{t("deleteRow", { name: repo.fullName })}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: repo.fullName })}</DialogTitle>
          <DialogDescription>
            {isCascading
              ? t("deleteDescriptionCascades", {
                  count: repo.projectCount,
                })
              : t("deleteDescription")}
          </DialogDescription>
        </DialogHeader>

        {isCascading ? (
          <p className="text-sm text-muted-foreground">
            {t("deleteArmPrompt")}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("cancel")}</Button>
          </DialogClose>
          {isCascading && !armed ? (
            <Button variant="destructive" onClick={() => setArmed(true)}>
              {t("deleteArm")}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: repo.id, force: isCascading })}
            >
              {remove.isPending ? <Spinner /> : null}
              {t("delete")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
