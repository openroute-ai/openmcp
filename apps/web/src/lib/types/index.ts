import type { ReactNode } from 'react'

/**
 * A single navigation entry, used for navbar links, sidebar links and footer
 * links. `items` turns the entry into a nested (dropdown or section) menu.
 */
export type MenuItem = {
  /** The text to display */
  title: string
  /** The description of the item */
  description?: string
  /** The icon to display */
  icon?: ReactNode
  /** The url to link to */
  href?: string
  /** Whether the link is external */
  external?: boolean
  /** The roles that are authorized to see the item */
  authorizeOnly?: string[]
  /** Only show the item to verified providers */
  requireProvider?: boolean
}

export type NestedMenuItem = MenuItem & {
  items?: MenuItem[]
}
