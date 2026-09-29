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
import { Textarea } from "@workspace/ui/components/textarea"
import { IconPencil } from "@tabler/icons-react"
import { useEnumLabel } from "@/lib/i18n/labels"
import { useTRPC } from "@/lib/trpc/client"

// The values are the wire format; the labels are translated, so the lists carry
// values only and each label comes from the `Status` / `Type` namespaces.
const STATUSES = [
  "active",
  "featured",
  "promoted",
  "deprecated",
  "hidden",
] as const
const TYPES = ["client", "server", "application", "skill", "persona"] as const

/** The subset of a project this form writes. */
type Editable = {
  id: string
  name: string
  description: string | null
  url: string | null
  status: string
  type: string
  logo: string | null
  twitter: string | null
  priority: number
  comments: string | null
  skillMdPath: string | null
  tags: { code: string }[]
}

/**
 * The project editor.
 *
 * Every field a repository supplies is editable, because a curated entry
 * routinely needs a better description or homepage than the repository
 * carries. Writing one is what turns it into an override: the server sets
 * `overrideDescription` and `overrideUrl` on the fields that changed, so a
 * later resync cannot quietly undo the edit, and the form does not make the
 * operator remember to tick a box that is not otherwise visible.
 *
 * Tags are replaced as a whole set, so the two concerns are saved by one
 * mutation and one round trip: a save that fixed the description but lost the
 * tag the operator just added is worse than no save at all.
 */
export function ProjectEditDialog({ project }: { project: Editable }) {
  const t = useTranslations("EditProject")
  const typeLabel = useEnumLabel("Type")
  const statusLabel = useEnumLabel("Status")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(project.name)
  const [description, setDescription] = React.useState(project.description ?? "")
  const [url, setUrl] = React.useState(project.url ?? "")
  const [status, setStatus] = React.useState(project.status)
  const [type, setType] = React.useState(project.type)
  const [logo, setLogo] = React.useState(project.logo ?? "")
  const [twitter, setTwitter] = React.useState(project.twitter ?? "")
  const [priority, setPriority] = React.useState(String(project.priority))
  const [comments, setComments] = React.useState(project.comments ?? "")
  const [skillMdPath, setSkillMdPath] = React.useState(project.skillMdPath ?? "")
  const [tagCodes, setTagCodes] = React.useState<string[]>(
    project.tags.map((tag) => tag.code)
  )

  const allTags = useQuery(trpc.tags.list.queryOptions())

  /**
   * Re-reads the form from the stored project.
   *
   * Done on the open event rather than in an effect: the form must show what
   * is saved, not the last edit, when an operator reopens after a save or
   * after the row changed underneath an open dialog. An effect would also
   * cascade a render on every keystroke the parent passes down.
   */
  const resetForm = React.useCallback(() => {
    setName(project.name)
    setDescription(project.description ?? "")
    setUrl(project.url ?? "")
    setStatus(project.status)
    setType(project.type)
    setLogo(project.logo ?? "")
    setTwitter(project.twitter ?? "")
    setPriority(String(project.priority))
    setComments(project.comments ?? "")
    setSkillMdPath(project.skillMdPath ?? "")
    setTagCodes(project.tags.map((tag) => tag.code))
  }, [project])

  const update = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        toast.success(t("saved"))
        setOpen(false)
      },
      onError: (error) => {
        toast.error(t("saveFailed"), { description: error.message })
      },
    })
  )

  const setTags = useMutation(
    trpc.projects.setTags.mutationOptions({
      onSuccess: () => {
        toast.success(t("saved"))
        setOpen(false)
      },
      onError: (error) => {
        toast.error(t("saveFailed"), { description: error.message })
      },
    })
  )

  const busy = update.isPending || setTags.isPending

  const invalidUrl = url.trim() !== "" && !/^https?:\/\//i.test(url.trim())

  function save() {
    const trimmedUrl = url.trim()
    const trimmedLogo = logo.trim()
    const trimmedTwitter = twitter.trim()
    const trimmedPath = skillMdPath.trim()

    setTags.mutate(
      { id: project.id, codes: tagCodes },
      {
        onSuccess: () => {
          update.mutate(
            {
              id: project.id,
              name: name.trim(),
              description: description.trim() === "" ? null : description.trim(),
              url: trimmedUrl === "" ? null : trimmedUrl,
              logo: trimmedLogo === "" ? null : trimmedLogo,
              twitter: trimmedTwitter === "" ? null : trimmedTwitter,
              comments: comments.trim() === "" ? null : comments.trim(),
              skillMdPath: trimmedPath === "" ? null : trimmedPath,
              priority: Number(priority) || 0,
              status: status as (typeof STATUSES)[number],
              type: type as (typeof TYPES)[number],
            },
            {
              onSuccess: () => {
                void queryClient.invalidateQueries({
                  queryKey: trpc.projects.byId.queryKey({ id: project.id }),
                })
                void queryClient.invalidateQueries({
                  queryKey: trpc.projects.list.queryKey(),
                })
              },
            }
          )
        },
        onError: (error) => {
          toast.error(t("saveFailed"), { description: error.message })
        },
      }
    )
  }

  function toggleTag(code: string) {
    setTagCodes((current) =>
      current.includes(code)
        ? current.filter((value) => value !== code)
        : [...current, code]
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <IconPencil />
          {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy && name.trim() !== "" && !invalidUrl) save()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">{t("field.name")}</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">{t("field.description")}</Label>
              <Textarea
                id="edit-description"
                value={description}
                rows={4}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-url">{t("field.url")}</Label>
              <Input
                id="edit-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com"
                aria-invalid={invalidUrl}
              />
              {invalidUrl ? (
                <p className="text-sm text-destructive">{t("invalidUrl")}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-status">{t("field.status")}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {statusLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-type">{t("field.type")}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="edit-type">
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-logo">{t("field.logo")}</Label>
                <Input
                  id="edit-logo"
                  value={logo}
                  onChange={(event) => setLogo(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-twitter">{t("field.twitter")}</Label>
                <Input
                  id="edit-twitter"
                  value={twitter}
                  onChange={(event) => setTwitter(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-priority">{t("field.priority")}</Label>
                <Input
                  id="edit-priority"
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-skill-md-path">
                  {t("field.skillMdPath")}
                </Label>
                <Input
                  id="edit-skill-md-path"
                  value={skillMdPath}
                  onChange={(event) => setSkillMdPath(event.target.value)}
                  placeholder="SKILL.md"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-comments">{t("field.comments")}</Label>
              <Textarea
                id="edit-comments"
                value={comments}
                rows={3}
                onChange={(event) => setComments(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>{t("field.tags")}</Label>
              {allTags.data && allTags.data.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {allTags.data.map((tag) => {
                    const selected = tagCodes.includes(tag.code)
                    return (
                      <Button
                        key={tag.code}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        onClick={() => toggleTag(tag.code)}
                      >
                        {tag.name}
                      </Button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("noTags")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={busy || name.trim() === "" || invalidUrl}
            >
              {busy ? <Spinner /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
