/**
 * Bootstrap prompt for installing the OpenMCP store into an Agent.
 *
 * The full install instructions (CLI and MCP flows) live in the markdown file
 * this prompt points at, so the copy here stays short enough to paste into a
 * chat. Both locales are exported because a page must render the prompt in the
 * language the reader is actually using — an English reader should not be
 * handed a Chinese prompt to paste into their own Agent.
 */
export const INSTALL_PROMPT =
  '请根据 https://www.openmcp.cn/install/openmcp.md 为当前 Agent 安装 OpenMCP 商店。'

export const INSTALL_PROMPT_EN =
  'Install the OpenMCP store for this Agent according to https://www.openmcp.cn/install/openmcp.md.'

export const INSTALL_PROMPT_URL = 'https://www.openmcp.cn/install/openmcp.md'

/** Picks the prompt matching the active locale. */
export const installPromptFor = (locale: string): string =>
  locale === 'en' ? INSTALL_PROMPT_EN : INSTALL_PROMPT
