/**
 * Adds translated text to a set of documents, reusing what did not change.
 *
 * Translation is billed per call, so an unchanged document whose previous
 * translation is still stored is passed through instead of being sent to the
 * model again. Callers decide the `translate` function: enabled runs use the
 * AI translator, disabled runs write empty fields, and a test injects whatever
 * it wants.
 */

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
 * One translation per skill, in input order, aligned with `skills`.
 *
 * A skill is not retranslated when its document is unchanged and an earlier
 * translation is on record — that is what `contentHash` decides. Anything
 * genuinely new or never translated goes through `translate`.
 */
export async function translateSkills<T extends TranslatableSkill>(
  skills: T[],
  stored: Map<string, SkillRow>,
  translate: Translate
): Promise<SkillTranslations[]> {
  const translations: SkillTranslations[] = []

  for (const skill of skills) {
    const before = stored.get(skill.skillDir)
    const unchanged =
      before !== undefined && before.contentHash === contentHash(skill.readme)

    if (unchanged && (before.descriptionZh || before.readmeZh)) {
      translations.push({
        descriptionZh: before.descriptionZh,
        readmeZh: before.readmeZh,
      })
    } else {
      translations.push(await translate(skill.description, skill.readme))
    }
  }

  return translations
}
