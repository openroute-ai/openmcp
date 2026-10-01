/**
 * Tests for the sidebar's link grouping.
 *
 * The rule lives apart from the component so it can be checked here: what the
 * sidebar draws is a list of headings and menus, and the part that can be wrong
 * quietly — two links that should share a heading ending up under separate ones,
 * or a heading's links arriving out of the order they were written in — is
 * decided by the split.
 */
import { describe, expect, it } from "vitest"

import { groupNavItems } from "@/lib/nav-groups"

type Item = { key: string; group?: string }

const labels = (items: Item[]) =>
  groupNavItems(items).map((group) => group.group)

const keys = (items: Item[]) =>
  groupNavItems(items).flatMap((group) => group.items.map((item) => item.key))

describe("groupNavItems", () => {
  it("keeps the entries of one group together under a single heading", () => {
    const groups = groupNavItems<string, Item>([
      { key: "overview", group: "insights" },
      { key: "rankings", group: "insights" },
    ])

    expect(groups).toEqual([
      {
        group: "insights",
        items: [
          { key: "overview", group: "insights" },
          { key: "rankings", group: "insights" },
        ],
      },
    ])
  })

  it("starts a new heading where the group changes", () => {
    expect(
      labels([
        { key: "overview", group: "insights" },
        { key: "projects", group: "catalog" },
        { key: "skills", group: "catalog" },
      ])
    ).toEqual(["insights", "catalog"])
  })

  it("keeps the written order inside a group and across groups", () => {
    const items: Item[] = [
      { key: "overview", group: "insights" },
      { key: "rankings", group: "insights" },
      { key: "projects", group: "catalog" },
      { key: "authors", group: "catalog" },
      { key: "tasks", group: "operations" },
    ]

    expect(keys(items)).toEqual(items.map((item) => item.key))
  })

  it("does not reach back for a group that has already ended", () => {
    // Gathering the two runs would silently reorder the list, so an entry that
    // names an earlier group gets a second heading instead.
    expect(
      labels([
        { key: "a", group: "insights" },
        { key: "b", group: "catalog" },
        { key: "c", group: "insights" },
      ])
    ).toEqual(["insights", "catalog", "insights"])
  })

  it("leaves entries without a group unlabelled", () => {
    const groups = groupNavItems<string, Item>([
      { key: "repos" },
      { key: "overview", group: "insights" },
    ])

    expect(groups.map((group) => group.group)).toEqual([undefined, "insights"])
  })

  it("renders nothing for an empty list", () => {
    expect(groupNavItems<string, Item>([])).toEqual([])
  })
})
