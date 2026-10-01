"use client"

import { useState } from "react"
import { IconChevronDown } from "@tabler/icons-react"

import type { FaqEntry } from "@/lib/faq"

/**
 * The accordion itself, shared by the landing section and `/faq`.
 *
 * A client component because opening a row is state. The list is passed in
 * rather than imported so the landing can show a subset and the standalone page
 * can show all of it out of one definition.
 *
 * The first row starts open: a list of closed rows reads as "there is nothing
 * here", and the answer to the first question is usually the one that decides
 * whether the reader keeps reading.
 */
export function FaqAccordion({
  items,
  className,
}: {
  items: FaqEntry[]
  className?: string
}) {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className={className ?? "mt-10 space-y-3"}>
      {items.map((item, i) => {
        const isOpen = open === i

        return (
          <div
            key={item.question}
            className={`rounded-xl border backdrop-blur-md transition-colors ${
              isOpen ? "border-primary/40 bg-card" : "border-border bg-card"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium"
            >
              {item.question}
              <IconChevronDown
                size={16}
                className={`shrink-0 text-muted-foreground transition-transform duration-300 ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            <div
              className={`grid overflow-hidden transition-all duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <p className="min-h-0 px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
                {item.answer}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
