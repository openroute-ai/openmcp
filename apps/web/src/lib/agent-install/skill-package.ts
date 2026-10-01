import { safeZipEntryPath } from "@/lib/zip/sanitize-entry-path"
import { buildStoreMcpUrl, getAppBaseUrl, getGatewayBaseUrl } from "./urls"

export type SkillPackageFile = { path: string; content: string }

export type SkillPackageInput = {
  id: string
  slug: string
  title: string
  description?: string | null
  readme?: string | null
  readmeEn?: string | null
  version?: string | null
  priceType?: "free" | "paid"
  /** P0: Optional author metadata for openmcp block */
  authorName?: string
  authorId?: string
  /** Existing source files from DB / metadata */
  sourceFiles?: SkillPackageFile[]
}

export type SkillPackageResult = {
  name: string
  files: SkillPackageFile[]
  /** Relative install dirs by runtime */
  targetDirs: Record<"cursor" | "claude-code" | "codex" | "generic", string>
}

function skillNameFromSlug(slug: string, title: string): string {
  const base = (slug || title || "skill")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "skill"
}

function buildSkillMdBody(input: SkillPackageInput, name: string): string {
  const origin = getAppBaseUrl()
  const detail = `${origin}/skills/${input.slug}`
  const packageUrl = `${origin}/api/skills/${input.id}/package`
  const installDocUrl = `${origin}/install/openmcp.md`
  const marketplaceUrl = `${origin}/skills`
  const storeMcp = buildStoreMcpUrl()
  const desc = (input.description || input.title || name)
    .replace(/\n+/g, " ")
    .trim()
  const version = input.version?.replace(/^v/i, "") || "0.1.0"
  const downloadedAt = new Date().toISOString()

  // P0: Build openmcp metadata block
  let openmcpBlock = `
openmcp:
  skillUrl: ${detail}
  slug: ${input.slug}
  installDocUrl: ${installDocUrl}
  marketplaceUrl: ${marketplaceUrl}
  skillId: ${input.id}
  downloadedAt: ${downloadedAt}`

  if (input.authorName && input.authorId) {
    const authorUrl = `${origin}/providers/${input.authorId}`
    openmcpBlock += `
  authorUrl: ${authorUrl}
  authorName: ${input.authorName}`
  }

  return `---
name: ${name}
description: ${JSON.stringify(desc)}
version: ${version}${openmcpBlock}
---

# ${input.title || name}

${input.description?.trim() || "OpenMCP marketplace skill."}

## Source

- Detail: ${detail}
- Package (zip): ${packageUrl}
- Install guide: ${installDocUrl}
- Price: ${input.priceType === "paid" ? "paid (requires entitlement)" : "free"}

## Install (Agent)

1. Download the zip from the package URL above (login required).
2. Unzip into your Agent skills directory as \`${name}/\`:
   - Cursor: \`~/.cursor/skills/${name}/\`
   - Claude Code: \`~/.claude/skills/${name}/\`
   - Codex: \`~/.codex/skills/${name}/\`
3. Reload the Agent session and verify the skill is listed.

## Store MCP (optional)

Register \`${storeMcp}\` with your OpenMCP API key, then call \`install_asset\` with kind \`skill\` and id/slug \`${input.slug}\`.

Gateway base (MCP/A2A only): ${getGatewayBaseUrl()} — never use Provider direct endpoints.
`
}

/** Build OpenMCP Store helper skill used on /start (teaches search/install via Store MCP or zip API). */
export function buildOpenmcpStoreHelperPackage(): SkillPackageResult {
  const origin = getAppBaseUrl()
  const storeMcp = buildStoreMcpUrl()
  const name = "openmcp-store"
  const skillMd = `---
name: ${name}
description: "Search and install Skills / MCP / A2A from the OpenMCP marketplace via Store MCP or zip download."
version: "1.0.0"
---

# OpenMCP Store

Help the user discover and install assets from OpenMCP (${origin}).

## Bootstrap

1. Read ${origin}/install/openmcp.md and follow it.
2. Prefer registering Store MCP: \`${storeMcp}\` with the user's API key from ${origin}/dashboard/apikeys.
3. Tools: \`search_assets\`, \`get_asset\`, \`install_asset\`.
4. For Skills without Store MCP: download \`GET ${origin}/api/skills/<id-or-slug>/package\` and unzip into the runtime skills dir.

## Rules

- MCP / A2A: platform gateway only — never Provider direct URLs.
- Paid skills require login / entitlement before package download.
`
  return {
    name,
    files: [
      { path: "SKILL.md", content: skillMd },
      {
        path: "README.md",
        content: `# openmcp-store\n\nHelper skill for installing OpenMCP marketplace assets.\nSee SKILL.md and ${origin}/install/openmcp.md.\n`,
      },
    ],
    targetDirs: {
      cursor: `~/.cursor/skills/${name}/`,
      "claude-code": `~/.claude/skills/${name}/`,
      codex: `~/.codex/skills/${name}/`,
      generic: `skills/${name}/`,
    },
  }
}

/**
 * Build minimal metadata-only SKILL.md for GitHub-sourced skills (P1 Gap A).
 * Contains only metadata + openmcp backlink block, no full content.
 */
export function buildMinimalSkillPackage(
  input: SkillPackageInput
): SkillPackageResult {
  const name = skillNameFromSlug(input.slug, input.title)
  const origin = getAppBaseUrl()
  const detail = `${origin}/skills/${input.slug}`
  const installDocUrl = `${origin}/install/openmcp.md`
  const marketplaceUrl = `${origin}/skills`
  const version = input.version?.replace(/^v/i, "") || "0.1.0"
  const downloadedAt = new Date().toISOString()

  // Build openmcp metadata block
  let openmcpBlock = `
openmcp:
  skillUrl: ${detail}
  slug: ${input.slug}
  installDocUrl: ${installDocUrl}
  marketplaceUrl: ${marketplaceUrl}
  skillId: ${input.id}
  downloadedAt: ${downloadedAt}`

  if (input.authorName && input.authorId) {
    const authorUrl = `${origin}/providers/${input.authorId}`
    openmcpBlock += `
  authorUrl: ${authorUrl}
  authorName: ${input.authorName}`
  }

  const minimalContent = `---
name: ${name}
description: ${JSON.stringify(input.description?.trim() || input.title)}
version: ${version}${openmcpBlock}
---

# ${input.title || name}

## OpenMCP Metadata

This is a minimal metadata file for a GitHub-sourced skill from the OpenMCP marketplace.

- Detail page: ${detail}
- Marketplace: ${marketplaceUrl}
- Install guide: ${installDocUrl}

For the actual skill content, please visit the GitHub repository URL provided in the detail page.
`

  return {
    name,
    files: [{ path: ".openmcp-meta.md", content: minimalContent }],
    targetDirs: {
      cursor: `~/.cursor/skills/${name}/`,
      "claude-code": `~/.claude/skills/${name}/`,
      codex: `~/.codex/skills/${name}/`,
      generic: `skills/${name}/`,
    },
  }
}

/** Produce a Skill package files array (always includes SKILL.md). */
export function buildSkillPackage(
  input: SkillPackageInput
): SkillPackageResult {
  const name = skillNameFromSlug(input.slug, input.title)
  // Keep non-SKILL.md sources; normalize paths
  //
  // `sourceFiles` 来自上传 ZIP，也可能是历史脏数据。`safeZipEntryPath` 是唯一
  // 的路径真源：这里放过去的每个名字最终都会出现在买家下载的 ZIP 里，
  // 一个 `../` 就够让买家在解压时把文件写到目标目录之外。
  const existing: SkillPackageFile[] = []
  for (const f of input.sourceFiles ?? []) {
    const path = safeZipEntryPath(f.path)
    if (!path) continue
    existing.push({ path, content: f.content })
  }

  const files: SkillPackageFile[] = []

  // 认 basename 而不是整条路径：上传的包常把 SKILL.md 放在 `pkg/SKILL.md`。
  // 原实现这里是 `path === 'skill.md'` 精确匹配，于是嵌套的 SKILL.md 既被当成
  // 普通文件保留、又触发"已存在 SKILL.md"分支去 `find` 一个不存在的精确匹配，
  // 买家就拿到两份互相矛盾的说明书。
  const isSkillMd = (p: string) =>
    p.split("/").pop()?.toLowerCase() === "skill.md"
  const existingSkillMd = existing.find((f) => isSkillMd(f.path))

  for (const f of existing) {
    if (isSkillMd(f.path)) continue
    files.push({ path: f.path, content: f.content })
  }

  if (!existingSkillMd) {
    files.unshift({ path: "SKILL.md", content: buildSkillMdBody(input, name) })
  } else {
    files.unshift({ path: "SKILL.md", content: existingSkillMd.content })
  }

  // Ensure a short README if none
  if (
    !files.some((f) =>
      /^readme(\.md|\.en\.md)?$/i.test(f.path.replace(/^.*\//, ""))
    )
  ) {
    const readme = input.readme?.trim() || input.readmeEn?.trim()
    if (readme) {
      files.push({ path: "README.md", content: readme })
    }
  }

  return {
    name,
    files,
    targetDirs: {
      cursor: `~/.cursor/skills/${name}/`,
      "claude-code": `~/.claude/skills/${name}/`,
      codex: `~/.codex/skills/${name}/`,
      generic: `skills/${name}/`,
    },
  }
}

/** Short SkillHub-style prompt for copying to an Agent. */
export function buildSkillInstallCopyPrompt(opts: {
  slug: string
  origin?: string
  locale?: "zh" | "en"
}): string {
  const origin = (opts.origin || getAppBaseUrl()).replace(/\/$/, "")
  const md = `${origin}/install/openmcp.md`
  if (opts.locale === "en") {
    return `Please follow ${md} and install the skill \`${opts.slug}\`.`
  }
  return `请根据 ${md} ，安装 ${opts.slug}。`
}

/** Bootstrap prompt pointing at install markdown (home /start). */
export function buildStoreBootstrapCopyPrompt(opts?: {
  origin?: string
  locale?: "zh" | "en"
}): string {
  const origin = (opts?.origin || getAppBaseUrl()).replace(/\/$/, "")
  const md = `${origin}/install/openmcp.md`
  if (opts?.locale === "en") {
    return `Install the OpenMCP store for this Agent according to ${md}.`
  }
  return `请根据 ${md} 为当前 Agent 安装 OpenMCP 商店。`
}
