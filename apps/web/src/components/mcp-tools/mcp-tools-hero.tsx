'use client'

import { Input } from '@workspace/ui/components/input'
import { Search } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'

interface McpToolsHeroProps {
  onSearch?: (search: string) => void
  totalTools?: number
  initialSearch?: string
}

export function McpToolsHero({ onSearch, totalTools = 0, initialSearch = '' }: McpToolsHeroProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearch)

  useEffect(() => {
    setSearchQuery(initialSearch)
  }, [initialSearch])

  const handleSearch = (e: FormEvent) => {
    e.preventDefault()
    onSearch?.(searchQuery)
  }

  return (
    <div className='mx-auto w-full max-w-page px-gutter py-10 sm:px-gutter-sm lg:px-gutter-lg'>
      <div className='mb-8 text-center'>
        <h1 className='mb-2 font-bold text-foreground text-title'>MCP 工具库</h1>
        <div className='mb-3 text-primary text-xl md:text-2xl'>
          <span className='font-semibold'>{totalTools.toLocaleString()}</span>
          <span className='ml-2'>个可用工具</span>
        </div>
        <p className='text-lg text-muted-foreground'>浏览各技能包提供的 MCP 工具，查看输入输出与用法</p>
      </div>
      <div className='mx-auto mb-8 max-w-4xl'>
        <div className='relative'>
          <form onSubmit={handleSearch} className='flex items-center'>
            <Input
              type='text'
              name='q'
              placeholder='搜索工具名称或描述...'
              className='h-12 w-full bg-background pr-12 text-foreground'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type='submit'
              className='absolute inset-y-0 right-0 flex items-center pr-4 transition-colors hover:text-primary'
              aria-label='搜索'
            >
              <Search className='h-5 w-5 text-muted-foreground' />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
