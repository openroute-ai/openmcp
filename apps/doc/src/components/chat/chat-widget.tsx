"use client"

import { useChat } from "@ai-sdk/react"
import { cn } from "@workspace/ui/lib/utils"
import {
  DefaultChatTransport,
  isToolUIPart,
  type UIMessage,
} from "ai"
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  RotateCcw,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { PreBlock } from "./code-block"

type SessionRow = {
  id: string
  title: string
  message_count: number
}

type Citation = { title: string; href: string }

/** 组件外的可变会话 id：transport 在创建时需要捕获写入函数。 */
const sessionHandle: { current: string | null } = { current: null }

/** 去掉回答末尾的「参考来源」段落（引用会单独以卡片/弹窗展示，避免重复） */
function trimSources(text: string): string {
  const idx = text.search(/\n\s*(?:参考来源|Sources|References)\s*[:：]/)
  if (idx === -1) return text
  return text.slice(0, idx).trim()
}

/** 提取 assistant 正文中的 /docs 引用链接；若正文未给出链接则兜底用 read_page 工具输出 */
function extractCitations(parts: UIMessage["parts"], text: string): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []

  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(text))) {
    const title = match[1]?.trim()
    const href = match[2] as string
    const path = href.startsWith("http") ? new URL(href).pathname : href
    if (!path.startsWith("/docs")) continue
    if (seen.has(path)) continue
    seen.add(path)
    citations.push({ title: title || path, href: path })
  }

  if (citations.length === 0) {
    const push = (title: string, href: string) => {
      if (seen.has(href)) return
      seen.add(href)
      citations.push({ title, href })
    }
    for (const part of parts ?? []) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue
      if (part.type !== "tool-read_page") continue
      const output = part.output
      if (
        !output ||
        typeof output !== "object" ||
        typeof (output as { href?: unknown }).href !== "string"
      ) {
        continue
      }
      const o = output as { href: string; title?: string }
      push(o.title || o.href, o.href)
    }
  }
  return citations
}

const WELCOME_ZH = [
  "你好！我是 OpenMCP 文档站的 AI 助手，可以帮你查找和解读 MCP / A2A / Skills 文档。",
  "试试问我：「如何接入一个 MCP Server？」或者「A2A 和 MCP 有什么区别？」",
].join("\n")

const WELCOME_EN = [
  "Hi! I'm the AI assistant of the OpenMCP docs site. I can look up and explain MCP / A2A / Skills documentation for you.",
  'Try asking: "How do I connect an MCP server?" or "What is the difference between A2A and MCP?"',
].join("\n")

function ToolStatus({ type }: { type: string }) {
  const label =
    type === "tool-list_pages"
      ? "正在浏览文档列表…"
      : type === "tool-grep"
        ? "正在检索关键词…"
        : type === "tool-read_page"
          ? "正在阅读文档…"
          : null
  if (!label) return null
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-xs text-fd-muted-foreground">
      <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-current" />
      <span className="truncate">{label}</span>
    </div>
  )
}

/** 提取消息中的纯文本内容（用于复制） */
function messageText(message: UIMessage): string {
  return trimSources(
    (message.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("\n")
  ).trim()
}

/** 引用来源详情弹窗（展示全部引用链接） */
function CitationsDialog({
  zh,
  citations,
  onClose,
}: {
  zh: boolean
  citations: Citation[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={zh ? "引用来源" : "Sources"}
    >
      <div
        className="absolute inset-0 bg-fd-background/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="animate-chat-in relative z-10 flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-fd-border px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <BookOpen className="size-3.5 text-fd-primary" />
            {zh ? `引用来源（${citations.length}）` : `Sources (${citations.length})`}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={zh ? "关闭" : "Close"}
            className="flex size-7 items-center justify-center rounded-md text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="chat-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
          {citations.map((c) => (
            <a
              key={c.href}
              href={c.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2 rounded-md border border-fd-border bg-fd-background px-3 py-2 text-sm transition-colors hover:border-fd-primary hover:text-fd-primary"
            >
              <span className="min-w-0 flex-1 break-words">{c.title}</span>
              <ExternalLink className="mt-0.5 size-3 shrink-0 opacity-50" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ChatWidget({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const sessionRestored = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const zh = locale !== "en"

  const close = useCallback(() => {
    setOpen(false)
    setConfirmClear(false)
  }, [])

  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          const id = response.headers.get("x-chat-session-id")
          if (id) sessionHandle.current = id
          return response
        },
      })
  )

  const chat = useChat({ transport })
  const { messages, sendMessage, stop, status, error, setMessages, regenerate } = chat

  const requestBody = useCallback(
    () => ({
      sessionId: sessionHandle.current ?? undefined,
      locale,
    }),
    [locale]
  )

  // 恢复最近会话（StrictMode 下 effect 会执行两次，用 ref 去重）
  useEffect(() => {
    if (sessionRestored.current) return
    sessionRestored.current = true
    void (async () => {
      try {
        const res = await fetch("/api/chat/sessions")
        const data = (await res.json()) as { sessions: SessionRow[] }
        const latest = data.sessions?.[0]
        if (!latest) return
        sessionHandle.current = latest.id
        const msgRes = await fetch(`/api/chat/sessions/${latest.id}/messages`)
        if (!msgRes.ok) return
        const msgData = (await msgRes.json()) as {
          messages: Array<{ id: string; role: string; parts: unknown[] }>
        }
        if (msgData.messages?.length) {
          setMessages(
            msgData.messages.map((m) => ({
              id: m.id,
              role: m.role as UIMessage["role"],
              parts: m.parts as UIMessage["parts"],
            }))
          )
        }
      } catch {
        // 静默
      }
    })()
  }, [setMessages])

  // 桌面端把对话面板右侧空间让给页面：给 body 加标记，由 CSS 把内容整体左移
  useEffect(() => {
    if (open) {
      document.body.dataset.chatOpen = "true"
    } else {
      delete document.body.dataset.chatOpen
    }
    return () => {
      delete document.body.dataset.chatOpen
    }
  }, [open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  // 输入框随内容自动增高（上限 max-h-24），清空后回到初始高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  function submit() {
    const text = input.trim()
    if (!text || status === "streaming" || status === "submitted") return
    setInput("")
    void sendMessage({ text }, { body: requestBody() })
  }

  /** 新建对话：清空内容并开启新会话 */
  function newChat() {
    if (status === "streaming" || status === "submitted") stop()
    if (!confirmClear) {
      setConfirmClear(true)
      window.setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    setMessages([])
    sessionHandle.current = null
    setInput("")
    setConfirmClear(false)
  }

  async function copyMessage(message: UIMessage) {
    const text = messageText(message)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(message.id)
      window.setTimeout(
        () => setCopiedId((cur) => (cur === message.id ? null : cur)),
        1500
      )
    } catch {
      // 忽略复制失败
    }
  }

  function retryMessage(messageId?: string) {
    if (status === "streaming" || status === "submitted") return
    void regenerate({ messageId, body: requestBody() })
  }

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i]
    }
    return null
  }, [messages])
  const citations = useMemo(
    () =>
      lastAssistant
        ? extractCitations(lastAssistant.parts, messageText(lastAssistant))
        : [],
    [lastAssistant]
  )

  const streaming = status === "streaming" || status === "submitted"

  return (
    <>
      {/* 悬浮入口 */}
      {!open && (
        <button
          type="button"
          aria-label={zh ? "打开 AI 助手" : "Open AI assistant"}
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full bg-fd-primary text-fd-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          <MessageCircle className="size-5" />
        </button>
      )}

      {/* 移动端遮罩 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-fd-background/60 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* 对话面板：桌面端占满右侧高度并推动页面内容左移；移动端为悬浮弹窗 */}
      <div
        aria-hidden={!open}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden border border-fd-border bg-fd-background shadow-2xl",
          "transition-[transform,visibility] duration-200 ease-in-out",
          "max-lg:inset-x-2 max-lg:inset-y-3 max-lg:rounded-2xl",
          "lg:inset-y-0 lg:right-0 lg:w-(--fd-chat-width) lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-s lg:shadow-[-8px_0_32px_rgba(0,0,0,0.08)]",
          open ? "visible translate-x-0" : "invisible translate-x-full"
        )}
        role="dialog"
        aria-label={zh ? "AI 助手" : "AI Assistant"}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-fd-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <div className="flex size-7 items-center justify-center rounded-md bg-fd-primary/10 text-fd-primary">
              <MessageCircle className="size-4" />
            </div>
            {zh ? "AI 助手" : "AI Assistant"}
            {streaming && (
              <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-fd-muted px-2 py-0.5 text-xs text-fd-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                {zh ? "回答中…" : "Typing…"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={newChat}
              title={zh ? "新建对话（清空内容）" : "New chat (clear content)"}
              aria-label={zh ? "新建对话" : "New chat"}
              className={cn(
                "flex h-8 min-w-8 items-center justify-center gap-1 rounded-md text-xs text-fd-muted-foreground transition-colors hover:bg-fd-muted hover:text-fd-foreground",
                confirmClear
                  ? "w-auto whitespace-nowrap bg-fd-destructive/10 px-2 text-destructive"
                  : "w-8"
              )}
            >
              {confirmClear ? (
                <>
                  <Check className="size-4" />
                  <span className="hidden sm:inline">
                    {zh ? "再点一次清空" : "Click again"}
                  </span>
                </>
              ) : (
                <Trash2 className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={close}
              aria-label={zh ? "关闭" : "Close"}
              className="flex size-8 items-center justify-center rounded-md text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* 消息列表 */}
        <div
          ref={scrollRef}
          className="chat-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3"
        >
          {messages.length === 0 && (
            <div className="rounded-lg bg-fd-muted/60 px-3 py-2.5 text-sm whitespace-pre-wrap">
              {zh ? WELCOME_ZH : WELCOME_EN}
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "animate-chat-in",
                message.role === "user" ? "flex justify-end" : "space-y-1"
              )}
            >
              <div
                className={cn(
                  message.role === "user"
                    ? "max-w-[85%] rounded-lg bg-fd-primary px-3 py-2 text-sm leading-relaxed text-fd-primary-foreground"
                    : "w-full break-words text-sm leading-relaxed",
                  message.role === "user" && "group relative"
                )}
              >
                {message.parts?.map((part, index) => {
                  if (part.type === "text") {
                    return message.role === "user" ? (
                      <span key={index} className="whitespace-pre-wrap">
                        {part.text}
                      </span>
                    ) : (
                      <div
                        key={index}
                        className="prose-sm max-w-none break-words leading-relaxed [&_a]:text-fd-primary [&_a]:break-all [&_p]:leading-relaxed [&_p]:my-1.5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:mt-2 [&_h3]:mb-1"
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            pre: PreBlock,
                            code: ({
                              className,
                              children,
                            }: {
                              className?: string
                              children?: React.ReactNode
                            }) =>
                              className?.includes("language-") ? (
                                <code className={className}>{children}</code>
                              ) : (
                                <code className="rounded-sm bg-fd-muted px-1 py-0.5 text-[0.85em] break-all">
                                  {children}
                                </code>
                              ),
                          }}
                        >
                          {trimSources(part.text)}
                        </ReactMarkdown>
                      </div>
                    )
                  }
                  if (isToolUIPart(part)) {
                    return <ToolStatus key={index} type={part.type} />
                  }
                  return null
                })}

                {message.role === "assistant" &&
                  streaming &&
                  message.id === messages[messages.length - 1]?.id && (
                    <span className="inline-flex h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-fd-foreground align-middle" />
                  )}

                {message.role === "assistant" && (
                  <div className="flex items-center gap-1 pt-1.5">
                    <button
                      type="button"
                      onClick={() => copyMessage(message)}
                      title={zh ? "复制回复" : "Copy reply"}
                      aria-label={zh ? "复制回复" : "Copy reply"}
                      className="inline-flex size-6 items-center justify-center rounded-md text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground"
                    >
                      {copiedId === message.id ? (
                        <Check className="size-3.5 text-fd-primary" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                    {message.id === lastAssistant?.id && !streaming && (
                      <button
                        type="button"
                        onClick={() => retryMessage(message.id)}
                        title={zh ? "重试" : "Retry"}
                        aria-label={zh ? "重试" : "Retry"}
                        className="inline-flex size-6 items-center justify-center rounded-md text-fd-muted-foreground hover:bg-fd-muted hover:text-fd-foreground"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 引用来源卡片（仅最后一条 assistant 有引用时显示，最多展示 3 个） */}
          {citations.length > 0 && lastAssistant && !streaming && (
            <div className="animate-chat-in rounded-lg border border-fd-border bg-fd-muted/40 px-3 py-2 text-xs text-fd-muted-foreground">
              <div className="mb-1.5 flex items-center gap-1 font-medium">
                <BookOpen className="size-3" />
                {zh ? "引用来源" : "Sources"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {citations.slice(0, 3).map((c) => (
                  <a
                    key={c.href}
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-fd-border bg-fd-background px-2 py-1 transition-colors hover:border-fd-primary hover:text-fd-primary"
                  >
                    <span className="truncate">{c.title}</span>
                    <ExternalLink className="size-2.5 shrink-0 opacity-50" />
                  </a>
                ))}
                {citations.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setShowSources(true)}
                    title={
                      zh
                        ? `查看全部 ${citations.length} 个引用来源`
                        : `View all ${citations.length} sources`
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-fd-border bg-fd-background px-2 py-1 font-medium transition-colors hover:border-fd-primary hover:text-fd-primary"
                  >
                    +{citations.length - 3}
                    {zh ? "更多" : "more"}
                  </button>
                )}
              </div>
            </div>
          )}

          {showSources && citations.length > 3 && (
            <CitationsDialog
              zh={zh}
              citations={citations}
              onClose={() => setShowSources(false)}
            />
          )}

          {(status === "submitted" || status === "streaming") &&
            messages[messages.length - 1]?.role !== "assistant" && (
              <div className="animate-chat-in inline-flex items-center gap-2 text-xs text-fd-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <span className="size-1.5 animate-chat-blink rounded-full bg-current" />
                  <span
                    className="size-1.5 animate-chat-blink rounded-full bg-current"
                    style={{ animationDelay: "0.2s" }}
                  />
                  <span
                    className="size-1.5 animate-chat-blink rounded-full bg-current"
                    style={{ animationDelay: "0.4s" }}
                  />
                </span>
                {zh ? "思考中…" : "Thinking…"}
              </div>
            )}
          {error && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <span>
                {zh ? "出错了，请重试。" : "Something went wrong, please retry."}
              </span>
              <button
                type="button"
                onClick={() => retryMessage()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-current px-1.5 py-0.5 transition-colors hover:bg-red-500/10"
              >
                <RotateCcw className="size-3" />
                {zh ? "重试" : "Retry"}
              </button>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex items-end gap-2 border-t border-fd-border p-3"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                submit()
              }
            }}
            maxLength={4000}
            placeholder={zh ? "输入问题…" : "Ask a question…"}
            className="max-h-24 flex-1 resize-none overflow-y-auto rounded-md border border-fd-border bg-transparent px-2.5 py-1.5 text-sm leading-relaxed outline-none focus-visible:border-fd-primary"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => stop()}
              aria-label="stop"
              className="flex size-8 shrink-0 items-center justify-center rounded-md border border-fd-border text-fd-muted-foreground hover:bg-fd-muted"
            >
              <Square className="size-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="send"
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-fd-primary text-fd-primary-foreground disabled:opacity-40"
            >
              <SendHorizontal className="size-3.5" />
            </button>
          )}
        </form>
      </div>
    </>
  )
}
