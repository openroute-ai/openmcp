import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { IconCheck, IconExternalLink, IconUsers } from "@tabler/icons-react"

import type { PublicAuthor } from "@/lib/public/radar"

/**
 * Who is behind a project, on the public detail page.
 *
 * A server component: the author row is public byline data, so there is nothing
 * to fetch in the browser and no reason to ship the dashboard's editor, its
 * refresh button and its tRPC client to an anonymous reader.
 *
 * Renders nothing when no author is recorded, which is a normal state rather
 * than an error — see `getPublicAuthor` on why the owner is the only key
 * available.
 */
export function PublicAuthorCard({ author }: { author?: PublicAuthor }) {
  if (!author) return null

  const avatar = author.avatar || author.avatarUrl
  const links: { href: string; label: string }[] = [
    { href: `https://github.com/${author.username}`, label: "GitHub" },
  ]
  if (author.homepage) links.push({ href: author.homepage, label: "主页" })
  if (author.twitter) {
    links.push({ href: `https://x.com/${author.twitter}`, label: "X" })
  }
  if (author.linkedin) {
    links.push({
      href: `https://linkedin.com/in/${author.linkedin}`,
      label: "LinkedIn",
    })
  }
  if (author.npmUsername) {
    links.push({
      href: `https://npmjs.com/~${author.npmUsername}`,
      label: "npm",
    })
  }

  return (
    <section className="grid gap-3 rounded-xl border border-border p-4">
      <div className="flex items-start gap-3">
        {avatar ? (
          <Avatar className="size-10">
            <AvatarImage src={avatar} alt="" />
            <AvatarFallback>{author.name.slice(0, 2)}</AvatarFallback>
          </Avatar>
        ) : null}

        <div className="grid min-w-0 gap-0.5">
          <p className="flex items-center gap-1 text-sm font-medium">
            <span className="truncate">{author.name}</span>
            {author.verified ? (
              <IconCheck
                className="size-3.5 shrink-0 text-primary"
                aria-label="已认证"
              />
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{author.username}
          </p>
        </div>
      </div>

      {author.bio ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {author.bio}
        </p>
      ) : null}

      {author.followers !== null ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <IconUsers className="size-3.5" aria-hidden />
          {author.followers.toLocaleString("en-US")} 位关注者
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {link.label}
            <IconExternalLink className="size-3" aria-hidden />
          </a>
        ))}
      </div>
    </section>
  )
}
