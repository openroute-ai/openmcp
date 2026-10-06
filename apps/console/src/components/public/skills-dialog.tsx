"use client"

/**
 * The interactive half of the public skills list: a dialog listing every skill
 * a project ships, and the row both the dialog and the page render.
 *
 * Client because the "显示更多" button has to open something — the list itself
 * is server-rendered in `public-skills.tsx`, and this module only owns the bits
 * that need a browser interaction to exist at all. The list rows live here too
 * so the two renderings cannot drift: the five on the page and the full set in
 * the dialog describe the same skill the same way.
 */

import { IconExternalLink } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"

/** A skill as the public pages name it: what it is, where it lives. */
export interface PublicSkillItem {
  name: string
  description: string
  skillDir: string
  /** The console's own outbound link to the skill's directory in the repo. */
  href: string
}

/** One skill, as a link that leaves this site for the repository. */
export function SkillListItem({ skill }: { skill: PublicSkillItem }) {
  return (
    <li>
      <a
        href={skill.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="group grid gap-1 rounded-md border border-border px-3 py-2 transition-colors hover:bg-accent"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium group-hover:underline">
            {skill.name}
          </span>
          <IconExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </span>
        {skill.description ? (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {skill.description}
          </span>
        ) : null}
        <code className="truncate text-[11px] text-muted-foreground">
          {skill.skillDir}
        </code>
      </a>
    </li>
  )
}

/**
 * The "显示更多" dialog: every skill, not just the five the page leads with.
 *
 * The trigger is a full-width button so the affordance reads as "the rest of
 * this list" rather than a control hiding somewhere above the fold. The list
 * scrolls inside the dialog because a long set of skills should not stretch a
 * modal to the edges of the viewport.
 */
export function SkillsDialog({ skills }: { skills: PublicSkillItem[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          显示更多（{skills.length} 项）
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>全部技能（{skills.length} 项）</DialogTitle>
        </DialogHeader>
        <ul className="grid max-h-[60vh] gap-2 overflow-y-auto pr-1">
          {skills.map((skill) => (
            <SkillListItem key={skill.skillDir} skill={skill} />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}