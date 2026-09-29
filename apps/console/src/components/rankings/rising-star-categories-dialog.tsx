"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
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
import { IconPlus, IconRefresh, IconSettings, IconTrash } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"

/** One category as the editor holds it. */
type Draft = {
  key: string
  count: number
  tags: string
  excludedTags: string
  disabled: boolean
}

function toDraft(category: {
  key: string
  count?: number
  tags?: string[]
  excludedTags?: string[]
  disabled?: boolean
}): Draft {
  return {
    key: category.key,
    count: category.count ?? 15,
    tags: (category.tags ?? []).join(", "),
    excludedTags: (category.excludedTags ?? []).join(", "),
    disabled: category.disabled === true,
  }
}

/** Comma-separated text back to a list, dropping blanks. */
function toList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
}

/**
 * Edits the categories a year's Rising Stars report is selected by.
 *
 * This configuration was a file per year in a sibling application, which meant
 * it could only be changed by a deploy from outside this repository. It is
 * stored here instead, and this is the editor for it: which tag codes a
 * category draws from, how many projects it takes, and whether it runs at all.
 *
 * Saving does not rebuild the report, because a build writes rows and runs a
 * full re-derivation. The rebuild button is separate so an operator can save a
 * configuration they are still working on.
 */
export function RisingStarCategoriesDialog({ year }: { year: number }) {
  const t = useTranslations("Rankings")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Draft[] | null>(null)

  const categories = useQuery(
    trpc.rankings.risingStarCategories.queryOptions({ year }, { enabled: open })
  )

  /**
   * The stored configuration until the operator touches something.
   *
   * Derived rather than copied into state on open, so a background refetch
   * cannot replace the list someone is editing with the stored one — and
   * `reset` is a plain state change rather than a second code path.
   */
  const rows = drafts ?? categories.data?.categories.map(toDraft) ?? []

  const save = useMutation(
    trpc.rankings.setRisingStarCategories.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("categoriesSaved", { count: result.count }))
        setOpen(false)
        setDrafts(null)
        void queryClient.invalidateQueries()
      },
      onError: (error) => {
        toast.error(t("categoriesSaveFailed"), { description: error.message })
      },
    })
  )

  const rebuild = useMutation(
    trpc.rankings.buildRisingStars.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("rebuildSucceeded", { year, count: result.count }))
        void queryClient.invalidateQueries()
      },
      onError: (error) => {
        toast.error(t("rebuildFailed"), { description: error.message })
      },
    })
  )

  function mutate(index: number, patch: Partial<Draft>) {
    setDrafts((current) =>
      current
        ? current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft))
        : current
    )
  }

  function add() {
    setDrafts((current) =>
      current
        ? [
            ...current,
            { key: "", count: 15, tags: "", excludedTags: "", disabled: false },
          ]
        : current
    )
  }

  function remove(index: number) {
    setDrafts((current) => current?.filter((_, at) => at !== index) ?? current)
  }

  function reset() {
    setDrafts(categories.data?.categories.map(toDraft) ?? null)
  }

  const keys = rows.map((row) => row.key.trim()).filter((key) => key !== "")
  const duplicate = new Set(keys).size !== keys.length
  const hasAll = keys.includes("all")
  const saveable = rows.length > 0 && hasAll && !duplicate

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Cleared on close so the next open re-reads rather than reopening a
        // list that was abandoned half-edited.
        if (!next) setDrafts(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconSettings />
          {t("categories")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("categoriesTitle", { year })}</DialogTitle>
          <DialogDescription>{t("categoriesDescription")}</DialogDescription>
        </DialogHeader>

        {categories.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {t("categoriesLoading")}
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="hidden grid-cols-[1fr_5rem_1fr_1fr_auto] items-end gap-2 text-xs font-medium text-muted-foreground">
              <Label>{t("categoriesColumn.key")}</Label>
              <Label>{t("categoriesColumn.count")}</Label>
              <Label>{t("categoriesColumn.tags")}</Label>
              <Label>{t("categoriesColumn.excludedTags")}</Label>
              <span className="w-16" />
            </div>

            {rows.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_5rem_1fr_1fr_auto]"
              >
                <Input
                  aria-label={t("categoriesColumn.key")}
                  value={row.key}
                  placeholder="framework"
                  onChange={(event) => mutate(index, { key: event.target.value })}
                />
                <Input
                  aria-label={t("categoriesColumn.count")}
                  type="number"
                  min={1}
                  value={row.count}
                  onChange={(event) =>
                    mutate(index, { count: Number(event.target.value) || 1 })
                  }
                />
                <Input
                  aria-label={t("categoriesColumn.tags")}
                  value={row.tags}
                  placeholder="framework, cli"
                  onChange={(event) => mutate(index, { tags: event.target.value })}
                />
                <Input
                  aria-label={t("categoriesColumn.excludedTags")}
                  value={row.excludedTags}
                  onChange={(event) =>
                    mutate(index, { excludedTags: event.target.value })
                  }
                />
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      aria-label={t("categoriesColumn.enabled")}
                      checked={!row.disabled}
                      onCheckedChange={(checked) =>
                        mutate(index, { disabled: !checked })
                      }
                    />
                  </div>
                  {/* "all" is the bucket every sub-category draws from, so
                      removing it would leave the build unable to run. */}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("categoriesColumn.remove")}
                    disabled={row.key.trim() === "all"}
                    onClick={() => remove(index)}
                  >
                    <IconTrash />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={add}>
                <IconPlus />
                {t("categoriesAdd")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={!categories.data || categories.data.isDefault}
              >
                <IconRefresh />
                {t("categoriesReset")}
              </Button>
              {categories.data?.isDefault ? (
                <Badge variant="secondary">{t("categoriesIsDefault")}</Badge>
              ) : null}
            </div>

            {!hasAll ? (
              <p className="text-sm text-destructive">{t("categoriesNeedsAll")}</p>
            ) : null}
            {duplicate ? (
              <p className="text-sm text-destructive">{t("categoriesDuplicate")}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("categoriesCancel")}</Button>
          </DialogClose>
          {/* Rebuild is offered next to save rather than hidden in the tasks
              page: the question after saving is almost always "what does this
              produce", and the answer takes one press. */}
          <Button
            variant="outline"
            disabled={rebuild.isPending || !!save.isPending}
            onClick={() => rebuild.mutate({ year })}
          >
            {rebuild.isPending ? <Spinner /> : null}
            {t("categoriesRebuild")}
          </Button>
          <Button
            disabled={save.isPending || !saveable}
            onClick={() =>
              save.mutate({
                year,
                categories: rows
                  .filter((row) => row.key.trim() !== "")
                  .map((row) => ({
                    key: row.key.trim(),
                    count: row.count,
                    ...(toList(row.tags).length > 0
                      ? { tags: toList(row.tags) }
                      : {}),
                    ...(toList(row.excludedTags).length > 0
                      ? { excludedTags: toList(row.excludedTags) }
                      : {}),
                    ...(row.disabled ? { disabled: true } : {}),
                  })),
              })
            }
          >
            {save.isPending ? <Spinner /> : null}
            {t("categoriesSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
