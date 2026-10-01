"use client"

import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import type { ReactNode } from "react"

/** 内容里 `<Tooltip tip="...">文本</Tooltip>`：悬停显示说明，包裹行内文本。 */
export function Tooltip({ tip, children }: { tip: string; children?: ReactNode }) {
  return (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dotted underline-offset-4 hover:underline">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm text-xs">{tip}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}
