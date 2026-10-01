import "server-only"

/**
 * Chat 会话存储（进程内）。
 *
 * docs 站点没有独立后端，这里提供一个进程内的会话存储：
 * - 供 ChatWidget 恢复最近一次对话；
 * - 供 API 归属校验（仅同一 visitorId 可读）。
 *
 * 局限：进程重启后会话丢失，且多副本之间不共享。如果需要持久化，
 * 可将本模块替换为数据库 / 外部 API 实现（接口保持不变即可）。
 */

export type StoredMessage = {
  id: string
  role: string
  parts: unknown[]
}

export type SessionRow = {
  id: string
  title: string
  locale: string
  message_count: number
  updated_at: string
}

type Session = SessionRow & {
  visitorId: string
  messages: StoredMessage[]
}

const sessions = new Map<string, Session>()

const MAX_SESSIONS_PER_VISITOR = 20
const MAX_MESSAGES_PER_SESSION = 100

function sessionsOf(visitorId: string): Session[] {
  return [...sessions.values()]
    .filter((session) => session.visitorId === visitorId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function listSessions(visitorId: string): SessionRow[] {
  return sessionsOf(visitorId)
    .slice(0, MAX_SESSIONS_PER_VISITOR)
    .map(({ id, title, locale, message_count, updated_at }) => ({
      id,
      title,
      locale,
      message_count,
      updated_at,
    }))
}

export function getSessionMessages(
  visitorId: string,
  sessionId: string
): StoredMessage[] | null {
  const session = sessions.get(sessionId)
  if (!session || session.visitorId !== visitorId) return null
  return session.messages
}

export function ensureSession(input: {
  sessionId?: string
  visitorId: string
  locale: string
}): string {
  const existing = input.sessionId ? sessions.get(input.sessionId) : undefined
  if (existing && existing.visitorId === input.visitorId) {
    existing.locale = input.locale
    return existing.id
  }

  const id = crypto.randomUUID()
  sessions.set(id, {
    id,
    visitorId: input.visitorId,
    locale: input.locale,
    title: "",
    message_count: 0,
    updated_at: new Date().toISOString(),
    messages: [],
  })

  // 清理超出上限的旧会话
  const all = sessionsOf(input.visitorId)
  for (const session of all.slice(MAX_SESSIONS_PER_VISITOR)) {
    sessions.delete(session.id)
  }

  return id
}

export function appendMessage(input: {
  sessionId: string | null
  visitorId: string
  role: "user" | "assistant"
  parts: unknown[]
  firstQuestion?: string
}): void {
  if (!input.sessionId) return
  const session = sessions.get(input.sessionId)
  if (!session || session.visitorId !== input.visitorId) return

  session.messages.push({
    id: crypto.randomUUID(),
    role: input.role,
    parts: input.parts,
  })
  if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
    session.messages.splice(0, session.messages.length - MAX_MESSAGES_PER_SESSION)
  }

  session.message_count = session.messages.length
  session.updated_at = new Date().toISOString()
  if (!session.title && input.role === "user" && input.firstQuestion) {
    session.title = input.firstQuestion.slice(0, 60)
  }
}
