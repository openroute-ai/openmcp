'use client'

import { Calendar, Wrench } from 'lucide-react'
import { Badge } from '@workspace/ui/components/badge'
import { LocaleLink } from '@/i18n/navigation'

type McpToolCardData = {
  id: string
  toolName: string
  name: string
  description: string
  skillSlug: string
  skillTitle: string
  isDeprecated: boolean
  date: string
}

interface McpToolCardProps {
  tool: McpToolCardData
}

export function McpToolCard({ tool }: McpToolCardProps) {
  return (
    <div className='flex h-full flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-300 hover:border-primary/50 hover:shadow-md'>
      <div className='flex flex-1 flex-col'>
        <div className='mb-2 flex items-start justify-between gap-2'>
          <LocaleLink
            href={`/tools/${tool.id}`}
            className='font-bold text-card-foreground text-lg transition-colors hover:text-primary line-clamp-1'
          >
            {tool.name || tool.toolName}
          </LocaleLink>
          {tool.isDeprecated && (
            <Badge variant='secondary' className='shrink-0 text-muted-foreground'>
              已弃用
            </Badge>
          )}
        </div>
        <p className='mb-3 line-clamp-2 flex-1 text-muted-foreground text-sm'>{tool.description || '暂无描述'}</p>
        <div className='mt-auto flex flex-wrap items-center gap-2 border-border border-t pt-2'>
          <LocaleLink
            href={`/skills/${tool.skillSlug}`}
            className='inline-flex items-center text-primary text-xs transition-colors hover:underline'
          >
            <Wrench className='mr-1 h-3.5 w-3.5' />
            {tool.skillTitle}
          </LocaleLink>
          <span className='flex items-center text-muted-foreground text-xs'>
            <Calendar className='mr-1 h-3.5 w-3.5' />
            {tool.date}
          </span>
        </div>
      </div>
    </div>
  )
}
