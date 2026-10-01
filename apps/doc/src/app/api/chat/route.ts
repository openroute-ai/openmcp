import { createOpenAI } from "@ai-sdk/openai"
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { chatConfig, isChatConfigured } from "@/lib/chat/config"
import { buildSystemPrompt } from "@/lib/chat/prompt"
import { checkRateLimit } from "@/lib/chat/rate-limit"
import { appendMessage, ensureSession } from "@/lib/chat/store"
import {
  grepContent,
  listPages,
  normalizeLocale,
  readPage,
} from "@/lib/chat/tools"
import { siteUrl } from "@/lib/shared"

export const maxDuration = 60

const VISITOR_COOKIE = "chat_visitor_id"

const requestSchema = z.object({
  sessionId: z.string().max(64).optional(),
  locale: z.enum(["zh", "en"]).default("zh"),
  messages: z.array(z.custom<UIMessage>()).min(1).max(20),
})

/**
 * 长度校验只统计文本 parts；assistant 历史在发给模型前剔除工具输出
 * （read_page 全文等体积大且无需回传），客户端展示仍保留完整 parts。
 */
function lightenMessages(messages: UIMessage[]): UIMessage[] | null {
  const result: UIMessage[] = []
  for (const message of messages) {
    const textParts = (message.parts ?? []).filter((part) => part.type === "text")
    if (JSON.stringify(textParts).length > 8000) return null
    if (message.role === "assistant") {
      const kept = (message.parts ?? []).filter(
        (part) => part.type === "text" || part.type === "reasoning"
      )
      result.push({ ...message, parts: kept })
    } else {
      result.push(message)
    }
  }
  return result
}

async function resolveVisitorId(): Promise<string> {
  const store = await cookies()
  const existing = store.get(VISITOR_COOKIE)?.value
  if (existing && /^[a-zA-Z0-9-]{8,64}$/.test(existing)) return existing
  return crypto.randomUUID()
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

function errorMessage(locale: "zh" | "en"): string {
  return locale === "en"
    ? "Sorry, the assistant is temporarily unavailable. Please try again later."
    : "抱歉，助手暂时不可用，请稍后重试。"
}

export async function POST(request: Request) {
  if (!isChatConfigured()) {
    return NextResponse.json({ error: "AI Chat 未配置" }, { status: 503 })
  }

  const ip = getClientIp(request)
  const limit = checkRateLimit(ip)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } }
    )
  }

  let body: z.infer<typeof requestSchema>
  try {
    body = requestSchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 })
  }

  const messages = lightenMessages(body.messages)
  if (!messages) {
    return NextResponse.json({ error: "消息过长" }, { status: 413 })
  }

  const locale = normalizeLocale(body.locale)
  const visitorId = await resolveVisitorId()
  const sessionId = ensureSession({
    sessionId: body.sessionId,
    visitorId,
    locale,
  })

  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  if (lastUser) {
    appendMessage({
      sessionId,
      visitorId,
      role: "user",
      parts: lastUser.parts ?? [],
      firstQuestion:
        lastUser.parts
          ?.filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          )
          .map((p) => p.text)
          .join(" ") || "",
    })
  }

  try {
    const openai = createOpenAI({
      apiKey: chatConfig.apiKey(),
      baseURL: chatConfig.baseURL(),
    })

    const result = streamText({
      model: openai.chat(chatConfig.model()),
      system: buildSystemPrompt(locale, siteUrl),
      messages: await convertToModelMessages(messages),
      tools: {
        list_pages: tool({
          description:
            locale === "en"
              ? "List all searchable documentation pages with title, href and excerpt. Call this first when you need to know what content is available."
              : "列出本站全部可检索文档页面（标题/href/摘要）。需要了解有哪些内容时先调用。",
          inputSchema: z.object({}),
          execute: async () => {
            const pages = await listPages(locale)
            return pages.slice(0, 80)
          },
        }),
        grep: tool({
          description:
            locale === "en"
              ? "Search documentation page bodies by keyword; returns matching lines with page title and href."
              : "按关键词检索文档正文，返回命中行、标题与该页 href。",
          inputSchema: z.object({
            pattern: z.string().min(1).max(200),
          }),
          execute: async ({ pattern }) => grepContent({ pattern, locale }),
        }),
        read_page: tool({
          description:
            locale === "en"
              ? 'Read the full markdown of a page by slug or href, e.g. "mcp/overview" or "/docs/mcp/overview" (long pages are truncated).'
              : '按 slug 或 href 读取页面全文 markdown，例如 "mcp/overview" 或 "/docs/mcp/overview"（超长会截断）。',
          inputSchema: z.object({
            slug: z.string().min(1).max(300),
          }),
          execute: async ({ slug }) => readPage(slug, locale),
        }),
      },
      stopWhen: stepCountIs(chatConfig.maxSteps()),
      maxOutputTokens: 1024,
    })

    const response = result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      onFinish: async ({ messages: updated }) => {
        const assistant = [...updated].reverse().find((m) => m.role === "assistant")
        if (!assistant) return
        appendMessage({
          sessionId,
          visitorId,
          role: "assistant",
          parts: assistant.parts ?? [],
        })
      },
    })

    response.headers.set("x-chat-session-id", sessionId)
    if (!request.headers.get("cookie")?.includes(VISITOR_COOKIE)) {
      response.headers.append(
        "set-cookie",
        `${VISITOR_COOKIE}=${visitorId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
      )
    }
    return response
  } catch (error) {
    console.error(
      "[chat] stream failed:",
      error instanceof Error ? error.message : String(error)
    )
    return NextResponse.json({ error: errorMessage(locale) }, { status: 500 })
  }
}
