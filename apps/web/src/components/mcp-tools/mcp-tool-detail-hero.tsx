'use client'

import { ChevronRight, Wrench } from 'lucide-react'
import { LocaleLink } from '@/i18n/navigation'

interface McpToolDetailHeroProps {
  tool: { toolName: string; name: string; skillSlug: string; skillTitle: string }
}

export function McpToolDetailHero({ tool }: McpToolDetailHeroProps) {
  const displayName = tool.name || tool.toolName

  return (
    <div className='mb-6'>
      <nav aria-label='Breadcrumb' className='mb-4 sm:mb-6'>
        <ol className='flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:gap-x-2 sm:text-sm'>
          <li className='flex items-center'>
            <LocaleLink href='/' className='text-primary transition-colors hover:text-primary/80'>
              首页
            </LocaleLink>
          </li>
          <li className='flex items-center'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <LocaleLink href='/tools' className='text-primary transition-colors hover:text-primary/80'>
              MCP 工具
            </LocaleLink>
          </li>
          <li className='flex items-center'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <LocaleLink href={`/skills/${tool.skillSlug}`} className='text-primary transition-colors hover:text-primary/80'>
              {tool.skillTitle}
            </LocaleLink>
          </li>
          <li className='hidden sm:flex min-w-0 items-center'>
            <ChevronRight className='mx-1 h-3 w-3 shrink-0 text-muted-foreground sm:mx-2 sm:h-4 sm:w-4' />
            <span className='line-clamp-1 min-w-0 truncate text-muted-foreground' aria-current='page' title={displayName}>
              {displayName}
            </span>
          </li>
        </ol>
      </nav>
      <header className='mb-6 sm:mb-10'>
        <h1 className='mb-2 flex items-center gap-2 font-bold text-xl text-foreground sm:text-2xl md:text-3xl'>
          <Wrench className='h-6 w-6 text-primary sm:h-7 sm:w-7' />
          {displayName}
        </h1>
        <p className='text-muted-foreground'>
          所属技能包：<LocaleLink href={`/skills/${tool.skillSlug}`} className='text-primary hover:underline'>{tool.skillTitle}</LocaleLink>
        </p>
      </header>
    </div>
  )
}
