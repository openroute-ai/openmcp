import { IconStar } from "@tabler/icons-react"

import { ProjectLogo } from "@/components/projects/project-logo"
import { LocaleLink } from "@/i18n/navigation"
import type { PublicProjectSummary } from "@/lib/public/radar"

/**
 * Other projects a reader might click next, on the public detail page.
 *
 * A server component like the author card, for the same reason: the list is
 * chosen by a query, not by the browser.
 *
 * Renders nothing when the project shares no tag with anything else public,
 * because a "related" heading over an empty box tells a reader they have reached
 * the end of the catalogue when they have only reached the end of the overlaps.
 */
export function PublicRelatedProjects({
  projects,
}: {
  projects: PublicProjectSummary[]
}) {
  if (projects.length === 0) return null

  return (
    <section className="grid gap-3 rounded-xl border border-border p-4">
      <h2 className="font-display text-sm font-bold tracking-tight">
        相关项目
      </h2>

      <ul className="grid gap-3">
        {projects.map((project) => (
          <li key={project.id}>
            <LocaleLink
              href={`/projects/${project.owner}/${project.name}`}
              className="group grid gap-1"
            >
              <span className="flex items-center gap-2">
                <ProjectLogo
                  name={project.name}
                  logo={project.logo}
                  avatar={project.avatar}
                  iconUrl={project.iconUrl}
                  className="size-5 shrink-0"
                />
                <span className="truncate text-sm font-medium group-hover:underline">
                  {project.fullName}
                </span>
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {project.stars.toLocaleString("en-US")}
                  <IconStar
                    className="mb-0.5 ml-0.5 inline size-3"
                    aria-hidden
                  />
                </span>
              </span>
              {project.description ? (
                <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {project.description}
                </span>
              ) : null}
              {project.tags.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {project.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-border px-1 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              ) : null}
            </LocaleLink>
          </li>
        ))}
      </ul>
    </section>
  )
}
