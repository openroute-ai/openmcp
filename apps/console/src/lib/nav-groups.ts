/**
 * Grouping for a sidebar's flat link list.
 *
 * The sidebars describe their links as one list, because that is the order a
 * reader is meant to meet them in, and a `group` on each entry is a claim about
 * which heading that entry belongs under. Splitting the list into headings is
 * done here rather than in the component so the rule can be tested without a
 * renderer: consecutive entries with the same group make one heading, and an
 * entry without a group keeps the unlabelled list it would have been in on its
 * own.
 */

export interface NavItem<G> {
  /** The heading this entry belongs under, if any. */
  group?: G
}

export interface NavGroup<G, I extends NavItem<G>> {
  /** `undefined` for the entries that came without a heading. */
  group: G | undefined
  items: I[]
}

/**
 * Splits `items` into groups, keeping the order they were written in: a group
 * ends where the next entry names a different one, so the same heading can
 * appear twice rather than silently gathering entries from further down the
 * list.
 */
export function groupNavItems<G, I extends NavItem<G>>(
  items: I[]
): NavGroup<G, I>[] {
  const groups: NavGroup<G, I>[] = []

  for (const item of items) {
    const open = groups.at(-1)

    if (open && open.group === item.group) {
      open.items.push(item)
    } else {
      groups.push({ group: item.group, items: [item] })
    }
  }

  return groups
}
