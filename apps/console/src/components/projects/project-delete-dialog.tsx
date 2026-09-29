"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { Spinner } from "@workspace/ui/components/spinner"
import { IconTrash } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"
import { useLocaleRouter } from "@/i18n/navigation"

/**
 * Deletes a project.
 *
 * Deletion is irreversible and a mis-click here drops a curated entry along
 * with every skill, snapshot and package row that hangs off it, so the dialog
 * asks for the project name rather than a yes. The navigation happens only
 * after the delete resolves: bouncing to the list first would leave the
 * operator on a page that still renders, then silently change under them.
 */
export function ProjectDeleteDialog({
  id,
  name,
}: {
  id: string
  name: string
}) {
  const t = useTranslations("DeleteProject")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useLocaleRouter()

  const [open, setOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState("")

  const remove = useMutation(
    trpc.projects.remove.mutationOptions({
      onSuccess: () => {
        toast.success(t("deleted"))
        void queryClient.invalidateQueries({
          queryKey: trpc.projects.list.queryKey(),
        })
        void queryClient.invalidateQueries({
          queryKey: trpc.overview.snapshot.queryKey(),
        })
        router.push("/dashboard/projects")
      },
      onError: (error) => {
        toast.error(t("deleteFailed"), { description: error.message })
      },
    })
  )

  const matches = confirm === name

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirm("")
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive">
          <IconTrash />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (matches && !remove.isPending) remove.mutate({ id })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title", { name })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="confirm-name">{t("confirmLabel")}</Label>
            <Input
              id="confirm-name"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder={name}
              autoComplete="off"
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
              variant="destructive"
              disabled={!matches || remove.isPending}
            >
              {remove.isPending ? <Spinner /> : <IconTrash />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
