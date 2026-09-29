import { and, eq } from 'drizzle-orm'
import { db } from "@/lib/db"
import { notifications, user } from "@workspace/db"
import { sendEmail } from '@/mail'

export async function notifyUser(input: {
  userId: string
  type: string
  title: string
  body: string
  metadata?: Record<string, unknown>
  email?: boolean
}) {
  await db.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    metadata: input.metadata ?? null,
  })

  if (!input.email) return

  const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, input.userId)).limit(1)
  if (!row?.email) return

  try {
    await sendEmail({
      to: row.email,
      subject: input.title,
      html: `<p>${input.body.replaceAll('\n', '<br/>')}</p>`,
      text: input.body,
    })
  } catch (error) {
    console.error('[notify] email failed', error)
  }
}

export async function notifyAdmins(input: { type: string; title: string; body: string; metadata?: Record<string, unknown> }) {
  const admins = await db.select({ id: user.id }).from(user).where(eq(user.role, 'admin'))
  for (const admin of admins) {
    await notifyUser({
      userId: admin.id,
      type: input.type,
      title: input.title,
      body: input.body,
      metadata: input.metadata,
      email: true,
    })
  }
}

export async function countUnread(userId: string) {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
  return rows.length
}
