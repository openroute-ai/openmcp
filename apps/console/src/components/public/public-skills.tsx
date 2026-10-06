import { IconBook2 } from "@tabler/icons-react"

import { outboundHref } from "@/lib/outbound"
import type { PublicProjectSkill } from "@/lib/public/radar"
import {
  SkillListItem,
  SkillsDialog,
  type PublicSkillItem,
} from "./skills-dialog"

/**
 * The skills a skill project ships, on the public detail page.
 *
 * A server component, like the author card: the set is chosen by a database
 * read, and there is nothing for the browser to fetch. The page renders this
 * only for `type === "skill"` projects, so it receives at most an empty list —
 * but it fits the rest of the module here: this component is the public skill
 * surface, and "none of the coupled parts are hidden" is easier to read when
 * the guard lives next to the caller, with the component staying honest about
 * its input.
 *
 * The first five skills are the page; the rest wait behind the "显示更多"
 * dialog, so a catalogue of twenty skills reads as a sample rather than a wall
 * on an already-long page. Every row links to its directory in the repository,
 * out through the console's `/out` link like all the page's exits.
 */

/** How many skills the page itself shows before the rest move behind the dialog. */
const MAX_VISIBLE = 5

export function PublicSkills({
  skills,
  fullName,
}: {
  skills: PublicProjectSkill[]
  fullName: string
}) {
  const items: PublicSkillItem[] = skills.map((skill) => ({
    name: skill.name,
    // The Chinese line when there is one; the echoes of a raw description and
    // its translation are not worth two rows per skill in one list.
    description: skill.descriptionZh || skill.description,
    skillDir: skill.skillDir,
    href: skillHref(fullName, skill.skillDir),
  }))

  const visible = items.slice(0, MAX_VISIBLE)

  return (
    <section className="grid gap-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-bold tracking-tight">技能</h2>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <IconBook2 className="size-3.5" aria-hidden />
          {skills.length} 项
        </span>
      </div>

      <ul className="grid gap-2">
        {visible.map((skill) => (
          <SkillListItem key={skill.skillDir} skill={skill} />
        ))}
      </ul>

      {/* The dialog is rendered whenever the list overflows the sample, not
          because it is clicked — the button needs a target either way. */}
      {skills.length > MAX_VISIBLE ? <SkillsDialog skills={items} /> : null}
    </section>
  )
}

/**
 * Where a skill lives on the repository, as a link.
 *
 * The `HEAD` ref is GitHub's alias for the default branch, so the link does
 * not rot when a repository's default branch is renamed. `outboundHref` can
 * only reject a URL it was not handed, so the fallback keeps the direct link
 * for the impossible case rather than leaving a dead row.
 */
function skillHref(fullName: string, skillDir: string): string {
  const url = `https://github.com/${fullName}/tree/HEAD/${skillDir}`
  return outboundHref(url) ?? url
}