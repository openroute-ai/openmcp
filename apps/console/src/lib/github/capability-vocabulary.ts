/**
 * Deriving the capability vocabulary and a project's tags from stored repo data.
 *
 * Two closed sets are built here, both from what the repositories already say
 * about themselves rather than from a hand-maintained list:
 *
 * - **capabilities** are the filterable facets (language, deployment, data
 *   source, runtime, auth, category). The `language` axis is read straight off
 *   `repos.languages`; the rest are a small keyword table matched against
 *   `repos.topics`, kept only when some repository actually carries the topic.
 *   Nothing is invented: a value the corpus does not exhibit is not in the
 *   vocabulary, so the classifier can never file a project under a language
 *   nobody uses.
 * - **tags** are the repository's own GitHub topics, which is where the schema
 *   says they come from (see `MAX_TAGS_PER_PROJECT`). A short stop-list drops
 *   the community/meta topics that say nothing about the project
 *   ("awesome-list", "hacktoberfest"), and the rest are slugified into codes.
 *
 * Both readers accept the two shapes `repos.languages` is stored in — names and
 * `{"name": …}` objects — by going through {@link languageNames}, the same
 * helper the pages use.
 */

import { CAPABILITY_AXES, type CapabilityAxis } from "@/db/schema"
import { languageNames } from "@/lib/github/languages"

export interface CapabilitySeed {
  axis: CapabilityAxis
  code: string
  label: string
}

interface CapabilityKeyword {
  topic: string
  axis: Exclude<CapabilityAxis, "language">
  code: string
  label: string
}

/**
 * The keyword table behind every non-language axis.
 *
 * A topic maps to exactly one capability, so a topic that could plausibly sit
 * on two axes ("cli" is both a kind of thing and a way to run it) is listed
 * once, under the axis where a reader filtering the catalogue would look for
 * it. The table is the vocabulary's *shape*; {@link deriveCapabilityVocabulary}
 * decides which entries the corpus actually supports.
 */
const CAPABILITY_KEYWORDS: CapabilityKeyword[] = [
  // data source
  { topic: "postgres", axis: "dataSource", code: "postgres", label: "PostgreSQL" },
  { topic: "postgresql", axis: "dataSource", code: "postgres", label: "PostgreSQL" },
  { topic: "mysql", axis: "dataSource", code: "mysql", label: "MySQL" },
  { topic: "mariadb", axis: "dataSource", code: "mariadb", label: "MariaDB" },
  { topic: "mongodb", axis: "dataSource", code: "mongodb", label: "MongoDB" },
  { topic: "mongo", axis: "dataSource", code: "mongodb", label: "MongoDB" },
  { topic: "redis", axis: "dataSource", code: "redis", label: "Redis" },
  { topic: "sqlite", axis: "dataSource", code: "sqlite", label: "SQLite" },
  { topic: "supabase", axis: "dataSource", code: "supabase", label: "Supabase" },
  { topic: "firebase", axis: "dataSource", code: "firebase", label: "Firebase" },
  { topic: "kafka", axis: "dataSource", code: "kafka", label: "Kafka" },
  { topic: "rabbitmq", axis: "dataSource", code: "rabbitmq", label: "RabbitMQ" },
  { topic: "nats", axis: "dataSource", code: "nats", label: "NATS" },
  { topic: "elasticsearch", axis: "dataSource", code: "elasticsearch", label: "Elasticsearch" },
  { topic: "opensearch", axis: "dataSource", code: "opensearch", label: "OpenSearch" },
  { topic: "clickhouse", axis: "dataSource", code: "clickhouse", label: "ClickHouse" },
  { topic: "duckdb", axis: "dataSource", code: "duckdb", label: "DuckDB" },
  { topic: "snowflake", axis: "dataSource", code: "snowflake", label: "Snowflake" },
  { topic: "bigquery", axis: "dataSource", code: "bigquery", label: "BigQuery" },
  { topic: "dynamodb", axis: "dataSource", code: "dynamodb", label: "DynamoDB" },
  { topic: "neo4j", axis: "dataSource", code: "neo4j", label: "Neo4j" },
  { topic: "sql-server", axis: "dataSource", code: "sql-server", label: "SQL Server" },
  { topic: "mssql", axis: "dataSource", code: "sql-server", label: "SQL Server" },
  { topic: "oracle", axis: "dataSource", code: "oracle", label: "Oracle" },
  { topic: "graphql", axis: "dataSource", code: "graphql", label: "GraphQL" },
  { topic: "grpc", axis: "dataSource", code: "grpc", label: "gRPC" },
  { topic: "pinecone", axis: "dataSource", code: "pinecone", label: "Pinecone" },
  { topic: "qdrant", axis: "dataSource", code: "qdrant", label: "Qdrant" },
  { topic: "chroma", axis: "dataSource", code: "chroma", label: "Chroma" },
  { topic: "milvus", axis: "dataSource", code: "milvus", label: "Milvus" },
  { topic: "weaviate", axis: "dataSource", code: "weaviate", label: "Weaviate" },
  { topic: "faiss", axis: "dataSource", code: "faiss", label: "Faiss" },
  { topic: "s3", axis: "dataSource", code: "s3", label: "S3" },

  // runtime
  { topic: "docker", axis: "runtime", code: "docker", label: "Docker" },
  { topic: "kubernetes", axis: "runtime", code: "kubernetes", label: "Kubernetes" },
  { topic: "k8s", axis: "runtime", code: "kubernetes", label: "Kubernetes" },
  { topic: "helm", axis: "runtime", code: "helm", label: "Helm" },
  { topic: "wasm", axis: "runtime", code: "wasm", label: "WebAssembly" },
  { topic: "webassembly", axis: "runtime", code: "wasm", label: "WebAssembly" },
  { topic: "electron", axis: "runtime", code: "electron", label: "Electron" },
  { topic: "nodejs", axis: "runtime", code: "nodejs", label: "Node.js" },
  { topic: "node-js", axis: "runtime", code: "nodejs", label: "Node.js" },
  { topic: "deno", axis: "runtime", code: "deno", label: "Deno" },
  { topic: "bun", axis: "runtime", code: "bun", label: "Bun" },
  { topic: "serverless", axis: "runtime", code: "serverless", label: "Serverless" },
  { topic: "aws-lambda", axis: "runtime", code: "aws-lambda", label: "AWS Lambda" },
  { topic: "lambda", axis: "runtime", code: "aws-lambda", label: "AWS Lambda" },
  { topic: "cloudflare-workers", axis: "runtime", code: "cloudflare-workers", label: "Cloudflare Workers" },
  { topic: "terraform", axis: "runtime", code: "terraform", label: "Terraform" },
  { topic: "nix", axis: "runtime", code: "nix", label: "Nix" },
  { topic: "vercel", axis: "runtime", code: "vercel", label: "Vercel" },

  // deployment
  { topic: "self-hosted", axis: "deployment", code: "self-hosted", label: "Self-hosted" },
  { topic: "selfhosted", axis: "deployment", code: "self-hosted", label: "Self-hosted" },
  { topic: "saas", axis: "deployment", code: "saas", label: "SaaS" },
  { topic: "cli", axis: "deployment", code: "cli", label: "CLI" },
  { topic: "desktop", axis: "deployment", code: "desktop", label: "Desktop" },
  { topic: "desktop-app", axis: "deployment", code: "desktop", label: "Desktop" },
  { topic: "browser-extension", axis: "deployment", code: "browser-extension", label: "Browser extension" },
  { topic: "chrome-extension", axis: "deployment", code: "browser-extension", label: "Browser extension" },
  { topic: "vscode-extension", axis: "deployment", code: "vscode-extension", label: "VS Code extension" },
  { topic: "vscode-plugin", axis: "deployment", code: "vscode-extension", label: "VS Code extension" },
  { topic: "mobile", axis: "deployment", code: "mobile", label: "Mobile" },
  { topic: "mobile-app", axis: "deployment", code: "mobile", label: "Mobile" },
  { topic: "api", axis: "deployment", code: "api", label: "API" },
  { topic: "rest-api", axis: "deployment", code: "api", label: "API" },

  // auth
  { topic: "oauth", axis: "auth", code: "oauth", label: "OAuth" },
  { topic: "oauth2", axis: "auth", code: "oauth", label: "OAuth" },
  { topic: "jwt", axis: "auth", code: "jwt", label: "JWT" },
  { topic: "sso", axis: "auth", code: "sso", label: "SSO" },
  { topic: "saml", axis: "auth", code: "saml", label: "SAML" },
  { topic: "ldap", axis: "auth", code: "ldap", label: "LDAP" },
  { topic: "okta", axis: "auth", code: "okta", label: "Okta" },
  { topic: "authentication", axis: "auth", code: "auth", label: "Auth" },
  { topic: "authorization", axis: "auth", code: "auth", label: "Auth" },
  { topic: "webauthn", axis: "auth", code: "webauthn", label: "WebAuthn" },
  { topic: "passkey", axis: "auth", code: "webauthn", label: "WebAuthn" },

  // category
  { topic: "framework", axis: "category", code: "framework", label: "Framework" },
  { topic: "library", axis: "category", code: "library", label: "Library" },
  { topic: "sdk", axis: "category", code: "sdk", label: "SDK" },
  { topic: "plugin", axis: "category", code: "plugin", label: "Plugin" },
  { topic: "mcp", axis: "category", code: "mcp", label: "MCP" },
  { topic: "mcp-server", axis: "category", code: "mcp-server", label: "MCP server" },
  { topic: "mcp-client", axis: "category", code: "mcp-client", label: "MCP client" },
  { topic: "llm", axis: "category", code: "llm", label: "LLM" },
  { topic: "ai-agent", axis: "category", code: "agent", label: "Agent" },
  { topic: "ai-agents", axis: "category", code: "agent", label: "Agent" },
  { topic: "agent", axis: "category", code: "agent", label: "Agent" },
  { topic: "chatbot", axis: "category", code: "chatbot", label: "Chatbot" },
  { topic: "rag", axis: "category", code: "rag", label: "RAG" },
  { topic: "database", axis: "category", code: "database", label: "Database" },
  { topic: "server", axis: "category", code: "server", label: "Server" },
  { topic: "template", axis: "category", code: "template", label: "Template" },
  { topic: "boilerplate", axis: "category", code: "boilerplate", label: "Boilerplate" },
  { topic: "dataset", axis: "category", code: "dataset", label: "Dataset" },
  { topic: "tool", axis: "category", code: "tool", label: "Tool" },
  { topic: "automation", axis: "category", code: "automation", label: "Automation" },
  { topic: "scraper", axis: "category", code: "scraper", label: "Scraper" },
  { topic: "monitoring", axis: "category", code: "monitoring", label: "Monitoring" },
  { topic: "search-engine", axis: "category", code: "search-engine", label: "Search engine" },
  { topic: "static-site-generator", axis: "category", code: "static-site-generator", label: "Static site generator" },
  { topic: "orm", axis: "category", code: "orm", label: "ORM" },
  { topic: "middleware", axis: "category", code: "middleware", label: "Middleware" },
  { topic: "cli-tool", axis: "category", code: "cli", label: "CLI" },
]

/**
 * Topics that say nothing about what a repository *is*.
 *
 * These are the community and meta labels GitHub users apply to everything —
 * the signal-to-noise of a card whose whole point is to be scanned at a glance
 * decides the list. Kept short on purpose: a topic that describes the project
 * ("python", "react") is a tag, and only the ones that describe the *audience*
 * or the *event* are dropped.
 */
const TAG_STOPLIST = new Set([
  "awesome",
  "awesome-list",
  "curated-list",
  "resources",
  "list",
  "collection",
  "hacktoberfest",
  "good-first-issue",
  "good-first-issues",
  "help-wanted",
  "first-timers-only",
  "beginner-friendly",
  "hackathon",
  "open-source",
  "opensource",
  "demo",
  "example",
  "examples",
  "sample",
])

/**
 * A stable, URL-safe code for a language name.
 *
 * The handful of names GitHub uses that do not survive a naive slug
 * (`C++`, `C#`, `F#`, `.NET`) are spelled out; everything else lowercases and
 * replaces runs of non-alphanumerics with a hyphen.
 */
export function slugifyLanguage(name: string): string {
  const special: Record<string, string> = {
    "c++": "cpp",
    "c#": "csharp",
    "f#": "fsharp",
    ".net": "dotnet",
    "visual basic .net": "vbnet",
  }
  const trimmed = name.trim()
  const known = special[trimmed.toLowerCase()]
  if (known) return known
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** A stable, URL-safe code for a topic, or an empty string when it has none. */
export function slugifyTopic(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function languageSeed(name: string): CapabilitySeed {
  return { axis: "language", code: slugifyLanguage(name), label: name }
}

/**
 * The capability vocabulary the corpus supports.
 *
 * `topics` and `languages` are the union across every repository. Language
 * values are all read; keyword values are included only when a repository
 * carries the matching topic, which is what makes the vocabulary a fact about
 * the catalogue rather than a wish-list.
 */
export function deriveCapabilityVocabulary(input: {
  topics: Iterable<string>
  languages: Iterable<string>
}): CapabilitySeed[] {
  const presentTopics = new Set<string>()
  for (const topic of input.topics) presentTopics.add(topic.trim().toLowerCase())

  const byKey = new Map<string, CapabilitySeed>()
  for (const seed of languageSeedFor(input.languages)) {
    byKey.set(`${seed.axis}:${seed.code}`, seed)
  }
  for (const keyword of CAPABILITY_KEYWORDS) {
    if (!presentTopics.has(keyword.topic)) continue
    const key = `${keyword.axis}:${keyword.code}`
    if (byKey.has(key)) continue
    byKey.set(key, {
      axis: keyword.axis,
      code: keyword.code,
      label: keyword.label,
    })
  }

  return [...byKey.values()].sort(
    (a, b) => axisIndex(a.axis) - axisIndex(b.axis) || a.code.localeCompare(b.code)
  )
}

function languageSeedFor(languages: Iterable<string>): CapabilitySeed[] {
  const byCode = new Map<string, CapabilitySeed>()
  for (const name of languages) {
    const seed = languageSeed(name)
    if (!seed.code) continue
    if (!byCode.has(seed.code)) byCode.set(seed.code, seed)
  }
  return [...byCode.values()]
}

function axisIndex(axis: CapabilityAxis): number {
  return CAPABILITY_AXES.indexOf(axis)
}

/**
 * The capabilities a single repository's own data supports, best first.
 *
 * Languages come first because they are stored as GitHub's own byte-ordered
 * list — the dominant language is the one a reader most wants to filter on.
 * Topics follow, matched through the same keyword table. This is the
 * deterministic half of a project's capabilities: it fills the 3-5 band even
 * when the model is unavailable or returns too few usable answers.
 */
export function deriveRepoCapabilitySeeds(
  topics: unknown,
  languages: unknown,
  limit: number
): CapabilitySeed[] {
  const seen = new Set<string>()
  const out: CapabilitySeed[] = []
  const push = (seed: CapabilitySeed) => {
    const key = `${seed.axis}:${seed.code}`
    if (!seed.code || seen.has(key)) return
    if (out.length >= limit) return
    seen.add(key)
    out.push(seed)
  }

  for (const name of languageNames(languages)) push(languageSeed(name))

  const topicList = Array.isArray(topics)
    ? topics.filter((topic): topic is string => typeof topic === "string")
    : []
  const present = new Set(topicList.map((topic) => topic.trim().toLowerCase()))
  for (const keyword of CAPABILITY_KEYWORDS) {
    if (present.has(keyword.topic)) push({ axis: keyword.axis, code: keyword.code, label: keyword.label })
  }

  return out
}

/**
 * A repository's tags, taken from its own GitHub topics.
 *
 * The stop-list and dedupe happen here; the `MAX_TAGS_PER_PROJECT` cap is
 * applied by `setProjectTags`, so the two numbers cannot drift apart.
 */
export function repoTagsFromTopics(
  topics: unknown,
  limit: number
): { code: string; name: string }[] {
  if (!Array.isArray(topics)) return []

  const out: { code: string; name: string }[] = []
  const seen = new Set<string>()
  for (const raw of topics) {
    if (typeof raw !== "string") continue
    const name = raw.trim()
    if (!name) continue
    const code = slugifyTopic(name)
    if (code.length < 2) continue
    if (TAG_STOPLIST.has(code)) continue
    if (seen.has(code)) continue
    seen.add(code)
    out.push({ code, name })
    if (out.length >= limit) break
  }
  return out
}
