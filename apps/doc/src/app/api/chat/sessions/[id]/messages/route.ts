import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getSessionMessages } from "@/lib/chat/store"

export const dynamic = "force-dynamic"

/** 恢复某个会话的消息记录（归属校验：仅本人 visitorId 可读） */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/chat/sessions/[id]/messages">
) {
  const { id } = await params

  const store = await cookies()
  const visitorId = store.get("chat_visitor_id")?.value
  if (!visitorId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const messages = getSessionMessages(visitorId, id)
  if (messages === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ sessionId: id, messages })
}
