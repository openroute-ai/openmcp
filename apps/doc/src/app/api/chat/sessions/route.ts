import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { listSessions } from "@/lib/chat/store"

export const dynamic = "force-dynamic"

/** 当前访客的历史会话列表 */
export async function GET() {
  const store = await cookies()
  const visitorId = store.get("chat_visitor_id")?.value
  if (!visitorId) {
    return NextResponse.json({ sessions: [] })
  }

  return NextResponse.json({ sessions: listSessions(visitorId) })
}
