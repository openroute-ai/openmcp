"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
import { useTRPC } from "@/lib/trpc/client"

const TYPES = [
  { value: "application", label: "Application" },
  { value: "skill", label: "Skill" },
  { value: "client", label: "Client" },
  { value: "server", label: "Server" },
  { value: "persona", label: "Persona" },
] as const

/**
 * The create-project form.
 *
 * The URL is the only required field and the type defaults to `application`,
 * matching the reference endpoint: an omitted type must not quietly publish a
 * repository as a skill, because a skill project is synced from its SKILL.md
 * and everything else is not.
 */
export function CreateProjectDialog() {
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
          toast.info(`${result.project.slug} is already a project`)
        } else {
          const synced = [
            result.readme.synced ? "README fetched" : null,
            result.skills && !result.skills.empty
              ? `${result.skills.count} skill(s)`
              : null,
          ].filter(Boolean)

          toast.success(`Created ${result.project.slug}`, {
            description:
              synced.length > 0
                ? synced.join(" · ")
                : "Queued for the next sync",
          })
        }

        setOpen(false)
        reset()
      },
      onError: (error) => {
        toast.error("Could not create the project", {
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
        <Button>New project</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Paste a GitHub repository URL. Its metadata, README and skills are
            fetched immediately.
          </DialogDescription>
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
            <Label htmlFor="project-url">Repository URL</Label>
            <Input
              id="project-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repo"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={url.length > 0 && !looksValid}
            />
            {url.length > 0 && !looksValid ? (
              <p className="text-sm text-destructive">
                Enter an owner and repository, or a full GitHub URL.
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="project-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="project-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!trimmed || create.isPending}
              className="gap-2"
            >
              {create.isPending ? <Spinner /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
