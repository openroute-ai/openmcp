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
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { IconPencil, IconPlus } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"

/** The subset of a category this form writes, as the list row supplies it. */
type EditableCategory = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
}

/**
 * Creates a category, or edits one in place.
 *
 * One dialog for both because the fields are the same set and only two rules
 * differ: on create the `code` is typed and required, on edit it is shown but
 * disabled — it is the stable value the classifier answers with, so renaming it
 * would orphan every project already filed under it. The service layer does not
 * accept a code change at all; disabling the input is how that reads in the UI
 * rather than arriving as a rejected save.
 */
export function CategoryFormDialog({
  category,
}: {
  /** Absent for the create trigger; present for the row's edit trigger. */
  category?: EditableCategory
}) {
  const t = useTranslations("Categories")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const isEdit = Boolean(category)

  const [open, setOpen] = React.useState(false)
  const [code, setCode] = React.useState(category?.code ?? "")
  const [name, setName] = React.useState(category?.name ?? "")
  const [description, setDescription] = React.useState(
    category?.description ?? ""
  )
  const [sortOrder, setSortOrder] = React.useState(
    String(category?.sortOrder ?? 0)
  )
  const [isActive, setIsActive] = React.useState(category?.isActive ?? true)

  const reset = React.useCallback(() => {
    setCode(category?.code ?? "")
    setName(category?.name ?? "")
    setDescription(category?.description ?? "")
    setSortOrder(String(category?.sortOrder ?? 0))
    setIsActive(category?.isActive ?? true)
  }, [category])

  const invalidate = () => {
    setOpen(false)
    void queryClient.invalidateQueries({
      queryKey: trpc.categories.list.queryKey(),
    })
  }

  const create = useMutation(
    trpc.categories.create.mutationOptions({
      onSuccess: (row) => {
        toast.success(t("created", { name: row.name }))
        invalidate()
      },
      onError: (error) => {
        toast.error(t("saveFailed"), { description: error.message })
      },
    })
  )

  const update = useMutation(
    trpc.categories.update.mutationOptions({
      onSuccess: (row) => {
        toast.success(t("saved", { name: row.name }))
        invalidate()
      },
      onError: (error) => {
        toast.error(t("saveFailed"), { description: error.message })
      },
    })
  )

  const busy = create.isPending || update.isPending
  const parsedSortOrder = Number.parseInt(sortOrder, 10)
  const validSortOrder = Number.isFinite(parsedSortOrder)
  const valid =
    name.trim() !== "" &&
    validSortOrder &&
    (isEdit || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(code.trim()))

  const submit = () => {
    if (busy || !valid) return
    if (category) {
      update.mutate({
        id: category.id,
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        isActive,
        sortOrder: parsedSortOrder,
      })
    } else {
      create.mutate({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        isActive,
        sortOrder: parsedSortOrder,
      })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        {isEdit ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("editRow", { name: category!.name })}
            title={t("editRow", { name: category!.name })}
          >
            <IconPencil />
          </Button>
        ) : (
          <Button size="sm">
            <IconPlus />
            {t("create")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {isEdit ? t("editTitle") : t("createTitle")}
            </DialogTitle>
            <DialogDescription>
              {isEdit ? t("editDescription") : t("createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="category-code">{t("field.code")}</Label>
            <Input
              id="category-code"
              value={code}
              disabled={isEdit}
              autoComplete="off"
              placeholder={t("field.codePlaceholder")}
              onChange={(event) => setCode(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? t("field.codeLocked") : t("field.codeHint")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category-name">{t("field.name")}</Label>
            <Input
              id="category-name"
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category-description">
              {t("field.description")}
            </Label>
            <Textarea
              id="category-description"
              value={description}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category-sort-order">{t("field.sortOrder")}</Label>
            <Input
              id="category-sort-order"
              type="number"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("field.sortOrderHint")}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
            <div className="grid gap-0.5">
              <Label htmlFor="category-active">{t("field.active")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("field.activeHint")}
              </p>
            </div>
            <Switch
              id="category-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !valid}>
              {busy ? <Spinner /> : null}
              {isEdit ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
