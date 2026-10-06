import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { IconCheck, IconUsers } from "@tabler/icons-react"

import { authorLinks } from "@/components/public/public-author-card"
import { PublicProjectBoard } from "@/components/public/public-project-list"
import { PublicShell } from "@/components/public/public-shell"
import { db } from "@/db/client"
import { LocaleLink } from "@/i18n/navigation"
import { siteTitle } from "@/lib/config/site"
import { outboundHref } from "@/lib/outbound"
import { PROJECT_TYPE_LABELS } from "@/lib/public/project-filters"
import {
  getPublicAuthor,
  listPublicProjectsByAuthor,
} from "@/lib/public/radar"

/**
 * One author's page: who they are, and everything they have had collected.
 *
 * The other half of the detail page's byline. Where the card answers "who is
 * behind this project", this page answers the reverse — "what else did this
 * person make" — by reading the same two tables, `hall_of_fame` for the person
 * and `projects` for the shelf, keyed the same way the card is: the GitHub
 * username is the only name an author reliably has, because it is the login
 * the repository was filed under.
 *
 * `force-dynamic` and anonymous like the project page it is linked from. An
 * author page is a destination for shared links, and the shelf it shows is
 * being curated continuously, so neither half earns a cache.
 */

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const author = await getPublicAuthor(db, username)

  if (!author) return { title: "作者不存在" }

  return {
    title: siteTitle(`${author.name}（@${author.username}）`),
    description:
      author.bio ?? `@${author.username} 在平台中收录的项目。`,
    alternates: { canonical: `/authors/${author.username}` },
    openGraph: {
      type: "profile",
      title: siteTitle(`${author.name}（@${author.username}）`),
      description: author.bio ?? undefined,
    },
  }
}

export default async function PublicAuthorPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const author = await getPublicAuthor(db, username)

  if (!author) notFound()

  const [projects, links] = await Promise.all([
    listPublicProjectsByAuthor(db, author.username),
    Promise.resolve(authorLinks(author)),
  ])

  const avatar = author.avatar || author.avatarUrl
  const totalStars = projects.reduce((sum, project) => sum + project.stars, 0)

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <LocaleLink
          href="/projects"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← 返回项目库
        </LocaleLink>

        <div className="mt-4 grid gap-4 rounded-xl border border-border p-6">
          <div className="flex flex-wrap items-center gap-3">
            {avatar ? (
              <Avatar className="size-14">
                <AvatarImage src={avatar} alt="" />
                <AvatarFallback>{author.name.slice(0, 2)}</AvatarFallback>
              </Avatar>
            ) : null}

            <div className="grid min-w-0 gap-1">
              <p className="flex items-center gap-1.5 font-display text-2xl font-bold tracking-tight">
                <span className="truncate">{author.name}</span>
                {author.verified ? (
                  <IconCheck
                    className="size-4 shrink-0 text-primary"
                    aria-label="已认证"
                  />
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">
                @{author.username}
              </p>
            </div>
          </div>

          {author.bio ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {author.bio}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {author.followers !== null ? (
              <span className="flex items-center gap-1">
                <IconUsers className="size-3.5" aria-hidden />
                {author.followers.toLocaleString("en-US")} 位关注者
              </span>
            ) : null}
            <span>
              在平台收录 {projects.length} 个项目，累计{" "}
              {totalStars.toLocaleString("en-US")} 星
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {links.map((link) => {
              const href = outboundHref(link.href)
              if (!href) return null
              return (
                <a
                  key={link.href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {link.label}
                </a>
              )
            })}
          </div>
        </div>

        <div className="mt-8">
          <PublicProjectBoard
            groups={[
              {
                title: `${author.name} 收录的项目`,
                emptyLabel: "这个作者还没有公开的被收录项目。",
                items: projects.map((project) => ({
                  id: project.id,
                  owner: project.owner,
                  name: project.name,
                  fullName: project.fullName,
                  description: project.description,
                  stars: project.stars,
                  type:
                    PROJECT_TYPE_LABELS[
                      project.type as keyof typeof PROJECT_TYPE_LABELS
                    ] ?? project.type,
                  status: project.status,
                  tags: project.tags,
                  logo: project.logo,
                  avatar: project.avatar,
                  iconUrl: project.iconUrl,
                })),
              },
            ]}
          />
        </div>
      </div>
    </PublicShell>
  )
}