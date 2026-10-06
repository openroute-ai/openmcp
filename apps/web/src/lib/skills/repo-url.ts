/**
 * Where a submitter is likely to paste a skill repository from.
 *
 * Three spellings reach the same repository: a GitHub URL, the bare
 * `owner/repo` that CI configs and the skills CLI use, and a skills.sh
 * listing page. skills.sh is where these skills are published, so it is the
 * URL people copy, and its path is `<owner>/<repo>` with an optional trailing
 * skill segment — the same owner and repo GitHub uses.
 *
 * Everything resolves to `https://github.com/<owner>/<repo>` because that is
 * the only spelling the downstream accepts: the console write API parses it
 * with its own GitHub-only parser, and the gateway matches
 * `skills.githubUrl` against the canonical form. A skills.sh URL passed
 * through untouched is rejected in three separate places.
 */

import { parseGithubRepoUrl } from "@/lib/gateway/names"

/** `skills.sh/<owner>/<repo>`, with or without scheme, `www.`, or a skill segment. */
const SKILLS_SH_RE =
  /^(?:https?:\/\/)?(?:www\.)?skills\.sh\/([^/\s?#]+)\/([^/\s?#]+)/i

export interface ResolvedSkillRepo {
  owner: string
  name: string
  fullName: string
  /** Canonical GitHub URL: what every downstream call expects. */
  url: string
}

/**
 * Resolves a pasted repository reference, or null when it names no repository.
 *
 * A skills.sh URL whose segments are `.`/`..` is rejected here rather than
 * being handed on: it parses as a bare slug, and the resulting
 * `https://github.com/../..` is not a repository anyone can submit.
 */
export function resolveSkillRepo(
  input: string | null | undefined
): ResolvedSkillRepo | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null

  const skillsSh = raw.match(SKILLS_SH_RE)
  const parsed = skillsSh
    ? parseGithubRepoUrl(`${skillsSh[1]}/${skillsSh[2]}`)
    : parseGithubRepoUrl(raw)
  if (!parsed) return null

  const { owner, name, fullName } = parsed
  if (owner === "." || name === "." || owner === ".." || name === "..") {
    return null
  }

  return { owner, name, fullName, url: `https://github.com/${fullName}` }
}
