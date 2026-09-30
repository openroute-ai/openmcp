"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormatter, useTranslations } from "next-intl"
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
import {
  IconPlus,
  IconRefresh,
  IconRestore,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"
import { APP_TIMEZONE } from "@/lib/time"

/**
 * One category as the editor holds it.
 *
 * Every field the selection reads is here, including `excluded`. It is a slug
 * deny-list rather than a tag filter, and it is the one that is easy to forget:
 * the server accepts it and the selection honours it, so a draft that dropped it
 * would not fail loudly — it would quietly delete the exclusions from every
 * category the operator had ever configured.
 */
type Draft = {
  key: string
  count: number
  tags: string
  excludedTags: string
  excluded: string
  disabled: boolean
}

type StoredCategory = {
  key: string
  count?: number
  tags?: string[]
  excludedTags?: string[]
  excluded?: string[]
  disabled?: boolean
}

function toDraft(category: StoredCategory): Draft {
  return {
    key: category.key,
    count: category.count ?? 15,
    tags: (category.tags ?? []).join(", "),
    excludedTags: (category.excludedTags ?? []).join(", "),
    excluded: (category.excluded ?? []).join(", "),
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
 * Server rejection messages, which are codes rather than prose.
 *
 * The editor checks both conditions before it lets save be pressed, so these are
 * the backstop for a stale tab or a second operator. Anything not in here falls
 * through to the raw message, which is the right thing for an error we have no
 * catalog entry for.
 */
const CATEGORY_ERRORS = {
  "rankings.risingStarsCategories.missingAll": "categoriesErrors.missingAll",
  "rankings.risingStarsCategories.duplicateKey":
    "categoriesErrors.duplicateKey",
} as const satisfies Record<string, string>

/**
 * Edits the categories a year's Rising Stars report is selected by.
 *
 * This configuration was a file per year in a sibling application, which meant
 * it could only be changed by a deploy from outside this repository. It is
 * stored here instead, and this is the editor for it: which tag codes a
 * category draws from, which tags and slugs it refuses, how many projects it
 * takes, and whether it runs at all.
 *
 * Saving does not rebuild the report, because a build writes rows and runs a
 * full re-derivation. The rebuild button is separate so an operator can save a
 * configuration they are still working on.
 */
export function RisingStarCategoriesDialog({ year }: { year: number }) {
  const t = useTranslations("Rankings")
  const format = useFormatter()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Draft[] | null>(null)

  const categories = useQuery(
    trpc.rankings.risingStarCategories.queryOptions({ year }, { enabled: open })
  )
  // Only fetched while the dialog is open, and only read if the operator asks
  // for the defaults back.
  const defaults = useQuery(
    trpc.rankings.risingStarDefaultCategories.queryOptions(undefined, {
      enabled: open,
    })
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
        const key =
          CATEGORY_ERRORS[error.message as keyof typeof CATEGORY_ERRORS]
        toast.error(t("categoriesSaveFailed"), {
          description: key ? t(key) : error.message,
        })
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
        ? current.map((draft, at) =>
            at === index ? { ...draft, ...patch } : draft
          )
        : current
    )
  }

  function add() {
    setDrafts((current) =>
      current
        ? [
            ...current,
            {
              key: "",
              count: 15,
              tags: "",
              excludedTags: "",
              excluded: "",
              disabled: false,
            },
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

  /**
   * Puts the seed configuration back on screen.
   *
   * A draft rather than a save, so it is undoable the same way every other
   * change in here is — an operator who pressed this by accident should be able
   * to go back to what they had without reloading the page.
   */
  function restoreDefaults() {
    setDrafts((defaults.data?.categories ?? []).map(toDraft))
  }

  const keys = rows.map((row) => row.key.trim()).filter((key) => key !== "")
  const duplicate = new Set(keys).size !== keys.length
  const hasAll = keys.includes("all")
  const saveable = rows.length > 0 && hasAll && !duplicate

  const rowsTemplate = "grid-cols-1 sm:grid-cols-[7rem_5rem_1fr_1fr_1fr_auto]"

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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
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
            <div
              className={`hidden items-end gap-2 text-xs font-medium text-muted-foreground sm:grid ${rowsTemplate}`}
            >
              <Label>{t("categoriesColumn.key")}</Label>
              <Label>{t("categoriesColumn.count")}</Label>
              <Label>{t("categoriesColumn.tags")}</Label>
              <Label>{t("categoriesColumn.excludedTags")}</Label>
              <Label>
                <span title={t("categoriesExcludedHint")}>
                  {t("categoriesColumn.excluded")}
                </span>
              </Label>
              <span className="w-16" />
            </div>

            {rows.map((row, index) => (
              <div
                key={index}
                className={`grid items-center gap-2 ${rowsTemplate}`}
              >
                <Input
                  aria-label={t("categoriesColumn.key")}
                  value={row.key}
                  placeholder="framework"
                  onChange={(event) =>
                    mutate(index, { key: event.target.value })
                  }
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
                  onChange={(event) =>
                    mutate(index, { tags: event.target.value })
                  }
                />
                <Input
                  aria-label={t("categoriesColumn.excludedTags")}
                  value={row.excludedTags}
                  onChange={(event) =>
                    mutate(index, { excludedTags: event.target.value })
                  }
                />
                <Input
                  aria-label={t("categoriesColumn.excluded")}
                  value={row.excluded}
                  placeholder="some-project-slug"
                  onChange={(event) =>
                    mutate(index, { excluded: event.target.value })
                  }
                />
                <div className="flex items-center gap-1">
                  <Switch
                    aria-label={t("categoriesColumn.enabled")}
                    checked={!row.disabled}
                    onCheckedChange={(checked) =>
                      mutate(index, { disabled: !checked })
                    }
                  />
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
              {/* Distinct from "reload stored": this one puts the seed back,
                  which is the state an operator cannot get to on their own once
                  they have started editing. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={restoreDefaults}
                disabled={!defaults.data || categories.data?.isDefault === true}
              >
                <IconRestore />
                {t("categoriesRestoreDefaults")}
              </Button>
              {categories.data?.isDefault ? (
                <Badge variant="secondary">{t("categoriesIsDefault")}</Badge>
              ) : null}
              {categories.data?.updatedAt ? (
                <span className="text-xs text-muted-foreground">
                  {t("categoriesUpdatedAt", {
                    // Written in Beijing time like every other date here, and
                    // read in it too: an operator's own zone would put the save
                    // on the wrong day for the eight hours either side of
                    // midnight.
                    date: format.dateTime(categories.data.updatedAt, {
                      dateStyle: "medium",
                      timeZone: APP_TIMEZONE,
                    }),
                  })}
                </span>
              ) : null}
            </div>

            {!hasAll ? (
              <p className="text-sm text-destructive">
                {t("categoriesNeedsAll")}
              </p>
            ) : null}
            {duplicate ? (
              <p className="text-sm text-destructive">
                {t("categoriesDuplicate")}
              </p>
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
                    ...(toList(row.excluded).length > 0
                      ? { excluded: toList(row.excluded) }
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
