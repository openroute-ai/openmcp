"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
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
import { Textarea } from "@workspace/ui/components/textarea"
import { IconPencil, IconRefresh } from "@tabler/icons-react"
import { useTRPC } from "@/lib/trpc/client"
import { LocaleLink } from "@/i18n/navigation"

/** The author fields this card and its editor work with. */
export type AuthorRow = {
  username: string
  name: string
  bio: string | null
  homepage: string | null
  twitter: string | null
  linkedin: string | null
  github: string | null
  /**
   * The mirrored copy, absent when mirroring is unavailable or has not run
   * yet. Preferred over `avatarUrl` because it is ours to serve; the remote URL
   * is the fallback, so a fetch that never mirrored still shows a picture.
   */
  avatar: string | null
  avatarUrl: string | null
  followers: number | null
  verified: boolean
  npmUsername: string | null
  npmPackageCount: number | null
}

/**
 * The two things an operator can do about an author.
 *
 * A refresh is one GraphQL request and rewrites whatever GitHub says, so it is
 * a button rather than something the page does for you — and it is the only
 * way to get followers, a bio or a display name at all, since a repository
 * knows only the login. The editor is for what GitHub does not carry: a LinkedIn
 * handle and npm details have no profile field to refresh from, and a curated
 * directory can only show them if a human writes them down.
 */
export function AuthorActions({
  author,
  /**
   * Called after a refresh or an edit lands.
   *
   * The list invalidates the whole cache on its own, because the row it cares
   * about is one it is holding. A detail page is holding a different query —
   * `authors.byId` rather than `authors.list` — so it passes a narrower callback
   * instead. Left optional rather than required so the list does not have to
   * know about pages that are not on screen.
   */
  onChanged,
}: {
  author: AuthorRow
  onChanged?: () => void
}) {
  const t = useTranslations("Author")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const refresh = useMutation(
    trpc.authors.refresh.mutationOptions({
      onSuccess: () => {
        toast.success(t("refreshed", { name: author.name }))
        void queryClient.invalidateQueries()
        onChanged?.()
      },
      onError: (error) => {
        toast.error(t("refreshFailed"), { description: error.message })
      },
    })
  )

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label={t("refresh", { name: author.name })}
        title={t("refresh", { name: author.name })}
        disabled={refresh.isPending}
        onClick={() => refresh.mutate({ username: author.username })}
      >
        {refresh.isPending ? <Spinner /> : <IconRefresh />}
        <span className="sr-only">{t("refresh", { name: author.name })}</span>
      </Button>
      <AuthorEditDialog author={author} onChanged={onChanged} />
    </div>
  )
}

/** Edits the fields no profile fetch can supply. */
function AuthorEditDialog({
  author,
  onChanged,
}: {
  author: AuthorRow
  onChanged?: () => void
}) {
  const t = useTranslations("Author")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(author.name)
  const [bio, setBio] = React.useState(author.bio ?? "")
  const [homepage, setHomepage] = React.useState(author.homepage ?? "")
  const [twitter, setTwitter] = React.useState(author.twitter ?? "")
  const [linkedin, setLinkedin] = React.useState(author.linkedin ?? "")
  const [npmUsername, setNpmUsername] = React.useState(author.npmUsername ?? "")
  const [npmCount, setNpmCount] = React.useState(
    author.npmPackageCount == null ? "" : String(author.npmPackageCount)
  )
  const [verified, setVerified] = React.useState(author.verified)

  const reset = React.useCallback(() => {
    setName(author.name)
    setBio(author.bio ?? "")
    setHomepage(author.homepage ?? "")
    setTwitter(author.twitter ?? "")
    setLinkedin(author.linkedin ?? "")
    setNpmUsername(author.npmUsername ?? "")
    setNpmCount(
      author.npmPackageCount == null ? "" : String(author.npmPackageCount)
    )
    setVerified(author.verified)
  }, [author])

  const update = useMutation(
    trpc.authors.update.mutationOptions({
      onSuccess: () => {
        toast.success(t("saved"))
        setOpen(false)
        void queryClient.invalidateQueries()
        onChanged?.()
      },
      onError: (error) => {
        toast.error(t("saveFailed"), { description: error.message })
      },
    })
  )

  function save() {
    const count = Number(npmCount)
    update.mutate({
      username: author.username,
      name: name.trim(),
      bio: bio.trim() === "" ? null : bio.trim(),
      homepage: homepage.trim() === "" ? null : homepage.trim(),
      twitter: twitter.trim() === "" ? null : twitter.trim(),
      linkedin: linkedin.trim() === "" ? null : linkedin.trim(),
      npmUsername: npmUsername.trim() === "" ? null : npmUsername.trim(),
      npmPackageCount:
        npmCount.trim() === "" || Number.isNaN(count) ? null : count,
      verified,
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
          aria-label={t("edit", { name: author.name })}
          title={t("edit", { name: author.name })}
        >
          <IconPencil />
          <span className="sr-only">{t("edit", { name: author.name })}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!update.isPending && name.trim() !== "") save()
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("editTitle", { name: author.name })}</DialogTitle>
            <DialogDescription>{t("editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="author-name">{t("field.name")}</Label>
            <Input
              id="author-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="author-bio">{t("field.bio")}</Label>
            <Textarea
              id="author-bio"
              value={bio}
              rows={3}
              onChange={(event) => setBio(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="author-homepage">{t("field.homepage")}</Label>
            <Input
              id="author-homepage"
              value={homepage}
              onChange={(event) => setHomepage(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="author-twitter">{t("field.twitter")}</Label>
              <Input
                id="author-twitter"
                value={twitter}
                onChange={(event) => setTwitter(event.target.value)}
              />
            </div>
            {/* LinkedIn and npm are not on the GitHub profile, so a refresh can
                never fill them. That is what these two fields are for. */}
            <div className="grid gap-2">
              <Label htmlFor="author-linkedin">{t("field.linkedin")}</Label>
              <Input
                id="author-linkedin"
                value={linkedin}
                onChange={(event) => setLinkedin(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="author-npm-username">
                {t("field.npmUsername")}
              </Label>
              <Input
                id="author-npm-username"
                value={npmUsername}
                onChange={(event) => setNpmUsername(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="author-npm-count">
                {t("field.npmPackageCount")}
              </Label>
              <Input
                id="author-npm-count"
                type="number"
                min={0}
                value={npmCount}
                onChange={(event) => setNpmCount(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="author-verified"
              checked={verified}
              onCheckedChange={setVerified}
            />
            <Label htmlFor="author-verified">{t("field.verified")}</Label>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={update.isPending || name.trim() === ""}
            >
              {update.isPending ? <Spinner /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The author card, as the project page shows it. */
export function AuthorCard({ author }: { author: AuthorRow }) {
  const t = useTranslations("Author")
  const a = useTranslations("Author")

  return (
    <li className="flex items-start gap-3">
      <Avatar className="size-9 shrink-0">
        {/* The mirror is tried first and GitHub's own URL second, so an author
            whose avatar has not been mirrored — or whose mirror failed —
            still shows a picture rather than initials. */}
        {author.avatar || author.avatarUrl ? (
          <AvatarImage
            src={author.avatar || author.avatarUrl!}
            alt={author.name}
          />
        ) : null}
        <AvatarFallback>{author.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
        <div className="flex items-center gap-1">
          {/* The name opens the author's own page: the list is a directory of
              profiles, and the profile is what an operator came for. GitHub
              stays reachable from there and from `AuthorLinks`, so nothing is
              lost by making the internal target the one on the name. */}
          <LocaleLink
            className="font-medium underline underline-offset-4"
            href={`/dashboard/authors/${author.username}`}
          >
            {author.name}
          </LocaleLink>
          {author.verified ? (
            <Badge variant="outline">{t("verified")}</Badge>
          ) : null}
          {author.npmPackageCount != null ? (
            <span className="text-xs text-muted-foreground">
              {a("npmPackages", { count: author.npmPackageCount })}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          @{author.username}
          {author.followers == null
            ? ""
            : ` · ${t("followers", { count: author.followers })}`}
        </span>
        {author.bio ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {author.bio}
          </span>
        ) : null}
        {/* The other places this author can be found. A card that collected a
            LinkedIn handle and then showed nothing would make the editor look
            broken, and these are the fields a refresh cannot fill — the only
            way they ever appear is if they are rendered here. */}
        <AuthorLinks author={author} />
      </div>
      <AuthorActions author={author} />
    </li>
  )
}

/**
 * The author's other profiles, as links.
 *
 * Each is shown only when it was actually collected, and each is labelled by
 * the site it points at rather than by the URL, so a card reads as a list of
 * places rather than a list of addresses.
 */
function AuthorLinks({ author }: { author: AuthorRow }) {
  const a = useTranslations("Author")

  const links: { href: string; label: string }[] = []
  if (author.homepage) {
    links.push({ href: author.homepage, label: a("link.homepage") })
  }
  if (author.twitter) {
    links.push({
      href: `https://twitter.com/${author.twitter.replace(/^@/, "")}`,
      label: `@${author.twitter.replace(/^@/, "")}`,
    })
  }
  if (author.linkedin) {
    links.push({ href: author.linkedin, label: "LinkedIn" })
  }
  if (author.npmUsername) {
    links.push({
      href: `https://www.npmjs.com/~${author.npmUsername}`,
      label: `npm:~${author.npmUsername}`,
    })
  }

  if (links.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-xs">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline underline-offset-4"
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}
