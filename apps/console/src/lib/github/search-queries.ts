/**
 * Repository discovery queries.
 *
 * Ported from `agent-skills-hub` in the source project. The discovery task
 * runs `CORE_QUERIES` on every cycle, `OPENCLAW_QUERIES` alongside them,
 * and the full set weekly to avoid burning search-API budget on a daily
 * basis.
 */

/** Run on every discovery cycle. */
export const CORE_QUERIES = [
  "mcp-server in:name,topics",
  "claude-mcp in:name,description,topics",
  "model-context-protocol in:name,description,topics",
  "mcp in:topics language:python",
  "mcp in:topics language:typescript",
  "mcp-tool in:name,topics",
  "claude-skill in:name,description,topics",
  "claude-code in:topics",
  "agent-skill in:name,topics",
  "ai-agent-tool in:name,description,topics",
] as const

/** OpenClaw / NanoClaw ecosystem. */
export const OPENCLAW_QUERIES = [
  "openclaw in:topics stars:>50",
  "openclaw-skills in:topics",
  "nanoclaw in:topics,name stars:>50",
  "clawdbot in:topics stars:>50",
  "clawhub in:topics",
  "openclaw-plugin in:topics stars:>50",
] as const

/** Weekly / full-sync only. */
export const EXTENDED_QUERIES = [
  "mcp-plugin in:name,description,topics",
  "claude-code-skill in:name,description,topics",
  "anthropic in:topics language:python",
  "anthropic in:topics language:typescript",
  "agent-tools in:name,description,topics",
  "llm-tool in:name,description,topics",
  "llm-agent in:name,topics stars:>10",
  "ai-tools in:topics stars:>20",
  "codex-skills in:name,description,topics",
  "codex-cli in:name,topics",
  "codex in:name,topics stars:>100",
  "agent-skills in:topics stars:>50",
  "openai-agent in:name,topics",
  "openai-tool in:name,topics",
  "gemini-agent in:name,topics",
  "gemini-tool in:name,description,topics",
  "youmind in:name,description,topics",
  "youmind-plugin in:name,topics",
  "function-calling in:topics language:python stars:>50",
  "tool-use in:topics language:typescript stars:>50",
  "ai-automation in:topics stars:>20",
] as const

export const SEARCH_QUERIES = [
  ...CORE_QUERIES,
  ...OPENCLAW_QUERIES,
  ...EXTENDED_QUERIES,
] as const

/** Curated accounts whose repositories are always collected. */
export const MASTERS_USERS = [
  "op7418",
  "zarazhangrui",
  "joeseesun",
  "JimLiu",
  "Panniantong",
  "abczsl520",
] as const

/** Hand-picked repositories that are always included. */
export const EXTRA_REPOS = [
  "runningZ1/union-search-skill",
  "Panniantong/Agent-Reach",
  "JimLiu/baoyu-skills",
  "joeseesun/yt-search-download",
  "joeseesun/anything-to-notebooklm",
  "joeseesun/skill-publisher",
  "joeseesun/defuddle-skill",
  "joeseesun/qiaomu-x-article-publisher",
  "joeseesun/knowledge-site-creator",
  "joeseesun/qiaomu-music-player-spotify",
  "joeseesun/qiaomu-design-advisor",
  "abczsl520/nodejs-project-arch",
  "abczsl520/openclaw-memory-cn",
  "abczsl520/debug-methodology",
  "abczsl520/bug-audit-skill",
  "abczsl520/codex-review",
  "abczsl520/browser-use-skill",
  "abczsl520/game-quality-gates",
  "NanmiCoder/MediaCrawler",
  "ythx-101/x-tweet-fetcher",
  "cloudflare/skills",
  "teng-lin/agent-fetch",
  "sukilll/great-product-skills",
  "SaladDay/cc-switch-cli",
  "laolin5564/openclaw-wx-echo",
  "JeffLi1993/seo-audit-skill",
] as const

/**
 * Topic and name fragments that mark a repository as a skill/agent/MCP
 * package. A repository is only auto-registered when it matches one of
 * these, so an unrelated repository that happens to rank highly in a
 * search is not added.
 */
export const SKILL_MARKERS = [
  "skill",
  "skills",
  "mcp",
  "mcp-server",
  "model-context-protocol",
  "agent",
  "agent-skill",
  "agent-tools",
  "claude",
  "claude-code",
  "claude-skill",
  "openai-agent",
  "openai-tool",
  "gemini-agent",
  "gemini-tool",
  "codex",
  "codex-skill",
  "llm-tool",
  "llm-agent",
  "function-calling",
  "tool-use",
  "openclaw",
  "clawhub",
] as const
