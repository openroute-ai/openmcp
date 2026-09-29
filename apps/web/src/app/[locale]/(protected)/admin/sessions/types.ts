/**
 * Client-side view types for the sessions admin pages.
 */
export interface AdminSessionRow {
  id: string
  userId: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  userName: string | null
  userEmail: string | null
  /** Derived from `expiresAt` at query time; not a stored column. */
  active: boolean
}

/**
 * The detail view returns the same columns as the list.
 *
 * There is intentionally no `token`: it is the bearer credential, and the admin
 * console never needs it. Revocation is by session id.
 */
export type AdminSessionDetail = AdminSessionRow
