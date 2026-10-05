/**
 * Adds translated text to a set of documents, reusing what did not change.
 *
 * Translation is billed per call, so an unchanged document whose previous
 * translation is still stored is passed through instead of being sent to the
 * model again. Callers decide the `translate` function: enabled runs use the
 * AI translator, disabled runs write empty fields, and a test injects whatever
 * it wants.
 */

import { mapWithConcurrency } from "@/lib/concurrency"
import { contentHash } from "@/lib/github/skill"
import type { SkillRow } from "@/lib/github/service/skill"

export interface SkillTranslations {
  descriptionZh: string
  readmeZh: string
}

export interface TranslatableSkill {
  skillDir: string
  description: string
  readme: string
}

export type Translate = (
  description: string,
  readme: string
) => Promise<SkillTranslations>

/**
 * How many skills may be in translation at once.
 *
 * Each skill costs two model calls, so this is also the ceiling on how many
 * calls the model sees at a time. Four is the point where a thirteen-skill
 * repository stops being minutes of wall clock — the previous one-at-a-time
 * loop left a caller like the ingest route waiting long enough to be declared
 * dead — while staying well inside what a provider will queue.
 */
const TRANSLATE_CONCURRENCY = 4

/**
 * One translation per skill, in input order, aligned with `skills`.
 *
 * A skill is not retranslated when its document is unchanged and an earlier
 * translation is on record — that is what `contentHash` decides. Anything
 * genuinely new or never translated goes through `translate`.
 *
 * Skills that do need translating are translated together rather than one after
 * another, since a repository's skills are independent of each other. The results
 * still come back in input order, so the caller can keep zipping them against
 * `skills`, and a rejection still rejects the whole call exactly as the
 * sequential loop did.
 */
export async function translateSkills<T extends TranslatableSkill>(
  skills: T[],
  stored: Map<string, SkillRow>,
  translate: Translate
): Promise<SkillTranslations[]> {
  const translateOne = async (skill: T): Promise<SkillTranslations> => {
    const before = stored.get(skill.skillDir)
    const unchanged =
      before !== undefined && before.contentHash === contentHash(skill.readme)

    if (unchanged && (before.descriptionZh || before.readmeZh)) {
      return {
        descriptionZh: before.descriptionZh,
        readmeZh: before.readmeZh,
      }
    }
    return translate(skill.description, skill.readme)
  }

  return mapWithConcurrency(skills, TRANSLATE_CONCURRENCY, translateOne)
}
