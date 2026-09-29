"use client"

import * as React from "react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

/**
 * A project's mark.
 *
 * The sources are tried in order of how deliberate they are:
 *
 * 1. `logo` — the project's own logo, which only an editor sets, so it is an
 *    explicit choice and outranks anything derived.
 * 2. `avatar` — the GitHub avatar of the owner. Present wherever a caller
 *    derives one, and the one mark every published project has.
 * 3. `iconUrl` — the repository icon the sync already fetched. Good, but it is
 *    an asset that has to be mirrored first, so it is missing for a repository
 *    that has not been synced.
 * 4. The first two letters of the name, because a row with a hole in it reads
 *    as a loading failure rather than as a project without a logo.
 *
 * A failing source falls through to the next one instead of ending the search,
 * so a deleted GitHub account or an unmirrored icon degrades to something
 * rather than to a blank.
 *
 * The image is a plain `AvatarImage` rather than `next/image` on purpose: these
 * URLs come from whatever host the editor or the sync put in the column, and
 * `next/image` would need every one of those hosts listed before it would serve
 * a single one of them.
 */
export function ProjectLogo({
  name,
  logo,
  avatar,
  iconUrl,
  className,
}: {
  name: string
  logo?: string | null
  avatar?: string | null
  iconUrl?: string | null
  className?: string
}) {
  const sources = React.useMemo(
    () => [logo, avatar, iconUrl].filter((url): url is string => Boolean(url)),
    [logo, avatar, iconUrl]
  )

  // Which source to show, as an index into `sources`. A number rather than a
  // "failed" flag, so each source is skipped in turn.
  const [index, setIndex] = React.useState(0)
  const src = sources[Math.min(index, sources.length - 1)]

  return (
    <Avatar
      className={cn("size-8 rounded-md", className)}
      // A logo is decoration next to the name, so it is announced by the name
      // rather than read out a second time.
      role="presentation"
    >
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          className="rounded-md"
          onError={() => setIndex((current) => current + 1)}
        />
      ) : null}
      <AvatarFallback className="rounded-md text-xs font-medium uppercase">
        {name.slice(0, 2)}
      </AvatarFallback>
    </Avatar>
  )
}
