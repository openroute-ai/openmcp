/**
 * The chat model behind the sync domain's AI work.
 *
 * `aiProvider` resolves the configuration; this turns that configuration into
 * a model the AI SDK can run. All three providers the config understands are
 * OpenAI-compatible chat endpoints, so one factory serves them.
 */

import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import { aiProvider } from "@/lib/env"

/** The model for the first configured provider, or undefined when none is. */
export function createChatModel(): LanguageModel | undefined {
  const provider = aiProvider()
  if (!provider) return undefined

  const openai = createOpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL.toString(),
  })
  return openai.chat(provider.model)
}
