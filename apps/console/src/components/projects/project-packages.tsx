"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
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
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"

/**
 * Publishes an npm package name against a project.
 *
 * The name is checked for shape here so an obviously wrong one is refused
 * before a request, and the server checks it again — a client-side check is a
 * convenience, not the boundary. Whether the package exists on npm is not
 * checked at all: the daily task fills that in, and making this depend on the
 * registry being reachable would mean a package could not be added during an
 * npm outage.
 */
export function AddPackageButton({ projectId }: { projectId: string }) {
  const t = useTranslations("ProjectDetail")
  // "Cancel" is the same word in every dialog on the page, so it is read from
  // the shared namespace rather than re-declared per component.
  const common = useTranslations("Common")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")

  const add = useMutation(
    trpc.projects.addPackage.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("packageAdded", { name: result.name }))
        setName("")
        setOpen(false)
        void queryClient.invalidateQueries()
      },
      onError: (error) => {
        toast.error(t("packageAddFailed"), { description: error.message })
      },
    })
  )

  const trimmed = name.trim()
  // The same shape the server accepts. Scoped names are one atom, so the scope
  // and the name are not validated separately.
  const valid =
    trimmed.length > 0 &&
    /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(trimmed)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <IconPlus />
          {t("addPackage")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addPackageTitle")}</DialogTitle>
          <DialogDescription>{t("addPackageDescription")}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid) add.mutate({ id: projectId, name: trimmed })
          }}
        >
          <Label htmlFor="package-name">{t("packageNameLabel")}</Label>
          <Input
            id="package-name"
            value={name}
            // npm names are lowercase by rule. Lowercased as it is typed so
            // what gets stored is what will resolve, rather than reporting a
            // name back that the registry would 404.
            onChange={(event) =>
              setName(event.target.value.trim().toLowerCase())
            }
            placeholder="@scope/name"
            autoComplete="off"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{t("addPackageHint")}</p>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common("cancel")}</Button>
          </DialogClose>
          <Button
            disabled={!valid || add.isPending}
            onClick={() => {
              if (valid) add.mutate({ id: projectId, name: trimmed })
            }}
          >
            {add.isPending ? <Spinner /> : null}
            {t("addPackage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Stops a project publishing one package.
 *
 * Asks first, because the row disappears from the project and the button is a
 * trash can in a table of dozens. The package itself is kept — the version, the
 * download count and the measured bundle size all survive, so re-adding the
 * name later costs nothing — which is why the confirmation says the name is
 * released rather than deleted.
 */
export function RemovePackageButton({
  projectId,
  packageName,
}: {
  projectId: string
  packageName: string
}) {
  const t = useTranslations("ProjectDetail")
  const common = useTranslations("Common")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)

  const remove = useMutation(
    trpc.projects.removePackage.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("packageRemoved", { name: result.name }))
        setOpen(false)
        void queryClient.invalidateQueries()
      },
      onError: (error) => {
        toast.error(t("packageRemoveFailed"), { description: error.message })
      },
    })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t("removePackageLabel", { name: packageName })}
          title={t("removePackageLabel", { name: packageName })}
        >
          <IconTrash />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("removePackageTitle", { name: packageName })}
          </DialogTitle>
          <DialogDescription>{t("removePackageDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common("cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: projectId, name: packageName })}
          >
            {remove.isPending ? <Spinner /> : null}
            {t("removePackage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
