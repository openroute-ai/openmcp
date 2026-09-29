/**
 * 落地页与营销文案中唯一权威的 Agent 运行时名单。
 * 任何新增运行时必须先改这里，避免各 section 各写一份导致口径冲突。
 */
export const RUNTIMES = [
  'Codex',
  'Hermes',
  'OpenCode',
  'DeepSeek Harness',
] as const

/** 用于正文内联的紧凑写法，例如：装进 Codex / Hermes / OpenCode / DeepSeek Harness */
export const RUNTIMES_TEXT = RUNTIMES.join(' / ')
