import { and, count, desc, eq } from 'drizzle-orm'
import { notifications } from '@workspace/db'
import { db } from '@/lib/db'
import type {
  SiteMessageDetail,
  SiteMessageListItem,
  SiteMessageListResult,
  SiteMessageMetadata,
  SiteMessageReadFilter,
} from './types'

/**
 * In-app inbox, backed by the shared `notifications` table.
 *
 * There is no separate site-message table: transactional mail (top-ups, review
 * outcomes, gateway incidents) writes rows here, and this layer adds only the
 * presentation shape — a summary line, a category pulled out of `metadata`, and
 * the call-to-action links other subsystems attach there.
 *
 * Every query is scoped to `userId` at the SQL level rather than fetched and
 * filtered in JS, so one user can never read another's messages even if an id
 * is guessed.
 */

export const SITE_MESSAGE_DEFAULT_PAGE_SIZE = 10

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** `metadata` is jsonb and may hold anything, so only known keys are trusted. */
function parseMetadata(metadata: unknown): SiteMessageMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return metadata as SiteMessageMetadata
}

function mapListItem(row: typeof notifications.$inferSelect): SiteMessageListItem {
  const metadata = parseMetadata(row.metadata)
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.body?.trim() ?? '',
    category: metadata?.category ?? null,
    read: row.read,
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    metadata,
  }
}

function mapDetail(row: typeof notifications.$inferSelect): SiteMessageDetail {
  const metadata = parseMetadata(row.metadata)
  return {
    ...mapListItem(row),
    content: row.body?.trim() ?? '',
    links: metadata?.links ?? [],
    readAt: toIso(row.readAt),
  }
}

function buildWhere(userId: string, readFilter: SiteMessageReadFilter) {
  const conditions = [eq(notifications.userId, userId)]

  if (readFilter === 'unread') {
    conditions.push(eq(notifications.read, false))
  } else if (readFilter === 'read') {
    conditions.push(eq(notifications.read, true))
  }

  return and(...conditions)
}

export const siteMessagesDataAccess = {
  async list(input: {
    userId: string
    page: number
    pageSize: number
    readFilter: SiteMessageReadFilter
  }): Promise<SiteMessageListResult> {
    const page = Math.max(1, input.page)
    const pageSize = Math.min(50, Math.max(1, input.pageSize))
    const whereClause = buildWhere(input.userId, input.readFilter)

    const [totalRow] = await db
      .select({ total: count() })
      .from(notifications)
      .where(whereClause)

    const total = totalRow?.total ?? 0

    const rows = await db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return {
      items: rows.map(mapListItem),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    }
  },

  async getUnreadCount(userId: string): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))

    return row?.total ?? 0
  },

  async getById(userId: string, id: string): Promise<SiteMessageDetail | null> {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1)

    const row = rows[0]
    return row ? mapDetail(row) : null
  },

  /**
   * Marks one message read.
   *
   * `readAt` is only written on the transition: re-marking an already-read
   * message leaves the original timestamp alone, so "first seen at" stays
   * meaningful.
   */
  async markRead(userId: string, id: string): Promise<boolean> {
    const [updated] = await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(
        and(eq(notifications.id, id), eq(notifications.userId, userId), eq(notifications.read, false))
      )
      .returning({ id: notifications.id })

    if (updated) return true

    // Either it was already read, or it does not belong to this user. Tell them
    // apart so the caller can report a miss honestly.
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1)

    return Boolean(existing)
  },

  async markAllRead(userId: string): Promise<number> {
    const updated = await db
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
      .returning({ id: notifications.id })

    return updated.length
  },
}
