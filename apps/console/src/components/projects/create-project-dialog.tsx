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

  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const [type, setType] = React.useState<string>("application")

  const trimmed = url.trim()
  // Cheap local check so the obvious typo does not cost a round trip. The
  // server parses it again; this is a hint, not the authority.
  const looksValid = /^[^/\s]+\/[^/\s]+$/.test(trimmed)

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
