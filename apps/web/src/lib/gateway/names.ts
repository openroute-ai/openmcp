const ASSET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export function isValidAssetName(name: string): boolean {
  return ASSET_NAME_RE.test(name) && name.length <= 80
}

/** LiteLLM MCP server_name 需符合 SEP-986（字母数字下划线/中划线，不含 /） */
export function toGatewayName(providerSlug: string, assetName: string): string {
  const provider = providerSlug.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
  const asset = assetName.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
  return `${provider}__${asset}`
}

export function parseGithubRepoUrl(url: string): { owner: string; name: string; fullName: string } | null {
  if (!url) return null
  const raw = url.trim()
  if (!raw) return null

  let match = raw.match(/(?:https?:\/\/|ssh:\/\/[^/]+@)?(?:www\.)?github\.com[/:]([^/\s?#]+)\/([^/\s?#]+)/i)
  if (!match) match = raw.match(/^git@github\.com[/:]([^/\s?#]+)\/([^/\s?#]+)/i)
  if (!match) match = raw.match(/^([^/\s?#]+)\/([^/\s?#]+)$/)

  if (!match) return null
  let owner = match[1]!.replace(/\/+$/, '')
  let name = match[2]!.replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!owner || !name) return null
  if (!/^[a-z0-9_.-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(name)) return null
  return { owner, name, fullName: `${owner}/${name}` }
}
