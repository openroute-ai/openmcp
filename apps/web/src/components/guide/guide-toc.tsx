'use client'

import type { TOCItemType } from 'fumadocs-core/toc'
import { TOCProvider, TOCScrollArea } from 'fumadocs-ui/components/toc'
import { TOCItem, TOCItems } from 'fumadocs-ui/components/toc/default'
import { cn } from '@/lib/utils'

interface GuideTocProps {
  toc: TOCItemType[]
  label: string
  className?: string
}

/**
 * Right-side sticky table of contents for the user guide.
 *
 * Built on Fumadocs' TOC primitives so the active-heading scroll-spy behaves
 * the same as it does on the docs site, which is where this component came
 * from. The nav is hidden below `lg` — the guide is read on a phone, where a
 * fixed 15rem column would cost more than it gives.
 */
export function GuideToc({ toc, label, className }: GuideTocProps) {
  return (
    <TOCProvider toc={toc}>
      <aside
        className={cn(
          'sticky top-24 hidden h-[calc(100vh-7rem)] w-60 shrink-0 flex-col ps-4 lg:flex',
          className
        )}
      >
        <p className="mb-3 text-sm font-medium text-muted-foreground">{label}</p>
        <TOCScrollArea className="min-h-0 flex-1 overflow-auto">
          <TOCItems thumbBox={false}>
            {toc.map((item) => (
              <TOCItem key={item.url} item={item} />
            ))}
          </TOCItems>
        </TOCScrollArea>
      </aside>
    </TOCProvider>
  )
}
