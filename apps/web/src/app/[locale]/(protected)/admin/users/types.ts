/**
 * Client-side view types for the users admin pages.
 *
 * Declared here rather than inferred from the router so the components can
 * share a row shape without every file importing router internals, and so a
 * router change shows up as a type error in one place.
 */
export interface AdminUserRow {
  id: string
  name: string
  email: string
  image: string | null
  role: string | null
  emailVerified: boolean
  phoneNumber: string | null
  phoneNumberVerified: boolean
  banned: boolean
  banReason: string | null
  banExpires: Date | null
  customerId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AdminUserDetail extends AdminUserRow {
  /** Sum of settled recharge order amounts, as a decimal string. */
  paidAmount: string
  paidOrderCount: number
  orderCount: number
}

export type UserSortColumn = 'createdAt' | 'name' | 'email' | 'role'
