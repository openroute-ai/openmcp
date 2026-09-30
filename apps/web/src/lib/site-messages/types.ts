/**
 * Site-message list item as rendered by the notification panel.
 *
 * `notifications` is a shared table (the settings notification centre reads the
 * same rows), so the read endpoints filter on ownership rather than a type
 * prefix: a message addressed to this user is theirs regardless of which
 * subsystem wrote it.
 */
export type SiteMessageLink = {
  label: string
  href: string
  external?: boolean
}

/** Shape of `notifications.metadata`, which is a free-form jsonb column. */
export type SiteMessageMetadata = {
  category?: string | null
  links?: SiteMessageLink[]
  [key: string]: unknown
}

export type SiteMessageListItem = {
  id: string
  type: string
  title: string
  summary: string
  category: string | null
  read: boolean
  createdAt: string
  metadata: SiteMessageMetadata | null
}

export type SiteMessageDetail = SiteMessageListItem & {
  content: string
  links: SiteMessageLink[]
  readAt: string | null
}

export type SiteMessageListResult = {
  items: SiteMessageListItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type SiteMessageReadFilter = 'all' | 'unread' | 'read'
