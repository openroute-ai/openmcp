/**
 * The outbound skill webhook payload.
 *
 * The consumer — the "web" service — stores these under its own names, so the
 * shape is a contract kept exactly as the source app sent it, snake_case
 * included. Optional fields the console does not yet track are sent as `null`
 * rather than omitted, because the consumer is not obliged to treat a missing
 * key and a null differently.
 */

export interface SkillWebhookPayload {
  event_type: "skill_updated"
  timestamp: string
  data: {
    repo_full_name: string
    repo_name: string
    repo_owner: string
    skill_dir: string
    name: string
    name_zh?: string | null
    description: string
    description_zh: string
    readme: string
    readme_zh: string
    version?: string | null
    category_id?: string | null
    features?: string[] | null
    scenario?: string | null
    license?: string | null
    tools?: string[] | null
  }
}

export interface SkillWebhookInput {
  repoOwner: string
  repoName: string
  skillDir: string
  name: string
  nameZh?: string | null
  description: string
  descriptionZh: string
  readme: string
  readmeZh: string
  version?: string | null
}

export function buildSkillWebhookPayload(
  params: SkillWebhookInput
): SkillWebhookPayload {
  return {
    event_type: "skill_updated",
    timestamp: new Date().toISOString(),
    data: {
      repo_full_name: `${params.repoOwner}/${params.repoName}`,
      repo_name: params.repoName,
      repo_owner: params.repoOwner,
      skill_dir: params.skillDir,
      name: params.name,
      name_zh: params.nameZh ?? null,
      description: params.description,
      description_zh: params.descriptionZh,
      readme: params.readme,
      readme_zh: params.readmeZh,
      version: params.version ?? null,
      category_id: null,
      features: null,
      scenario: null,
      license: null,
      tools: null,
    },
  }
}
