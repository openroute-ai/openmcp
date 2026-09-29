'use client'

import * as LucideIcons from 'lucide-react'
import { Search } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { cn } from '@/lib/utils/cn'

const commonIcons = [
  'Book',
  'FileText',
  'File',
  'Folder',
  'FolderOpen',
  'BookOpen',
  'Code',
  'Terminal',
  'Settings',
  'Database',
  'Server',
  'Cloud',
  'Globe',
  'Link',
  'Image',
  'Video',
  'Music',
  'Package',
  'Box',
  'Layers',
  'Grid',
  'List',
  'Menu',
  'Home',
  'User',
  'Users',
  'Mail',
  'MessageSquare',
  'Bell',
  'Heart',
  'Star',
  'Flag',
  'Tag',
  'CheckCircle',
  'XCircle',
  'AlertCircle',
  'Info',
  'HelpCircle',
  'Lock',
  'Unlock',
  'Key',
  'Shield',
  'Zap',
  'Flame',
  'Droplet',
  'Sun',
  'Moon',
  'Palette',
  'Brush',
  'PenTool',
  'Edit',
  'Trash',
  'Copy',
  'Download',
  'Upload',
  'Share',
  'ExternalLink',
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'ChevronRight',
  'ChevronLeft',
  'ChevronUp',
  'ChevronDown',
  'Plus',
  'Minus',
  'X',
  'Check',
  'MoreHorizontal',
  'MoreVertical',
  'Filter',
  'Search',
  'Calendar',
  'Clock',
  'Map',
  'Navigation',
  'Compass',
  'Camera',
  'Mic',
  'Headphones',
  'Monitor',
  'Smartphone',
  'Tablet',
  'Laptop',
  'Printer',
  'HardDrive',
  'Cpu',
  'MemoryStick',
  'Wifi',
  'Bluetooth',
  'Battery',
  'Power',
]

type IconComponent = React.ComponentType<{ className?: string }>

interface IconPickerProps {
  value?: string
  onChange: (iconName: string) => void
  className?: string
}

export function IconPicker({ value, onChange, className }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const allIcons = useMemo(() => {
    return Object.keys(LucideIcons).filter((name) => {
      const Icon = (LucideIcons as Record<string, unknown>)[name]
      return typeof Icon === 'function' && name[0] === name[0]?.toUpperCase() && name !== 'React'
    })
  }, [])

  const availableIcons = useMemo(() => {
    const combined = [...new Set([...commonIcons, ...allIcons])]
    return combined.sort()
  }, [allIcons])

  const filteredIcons = useMemo(() => {
    if (!search) return availableIcons
    const lowerSearch = search.toLowerCase()
    return availableIcons.filter((icon) => icon.toLowerCase().includes(lowerSearch))
  }, [availableIcons, search])

  const selectedIcon = value ? (LucideIcons as unknown as Record<string, IconComponent>)[value] : null

  const handleSelect = (iconName: string) => {
    onChange(iconName)
    setOpen(false)
    setSearch('')
  }

  const handleClear = () => {
    onChange('')
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          className={cn('w-full justify-start', !value && 'text-muted-foreground', className)}
        >
          {selectedIcon ? (
            <>
              {React.createElement(selectedIcon, { className: 'mr-2 h-4 w-4' })}
              {value}
            </>
          ) : (
            <>
              <Search className='mr-2 h-4 w-4' />
              选择图标
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[400px] p-0' align='start'>
        <div className='border-b p-4'>
          <div className='relative'>
            <Search className='absolute top-2.5 left-2 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='搜索图标...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-8'
            />
          </div>
        </div>
        <div className='h-[300px] overflow-y-auto overscroll-contain scroll-smooth [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:hover:bg-muted-foreground/50 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2'>
          <div className='p-4'>
            {filteredIcons.length === 0 ? (
              <div className='py-8 text-center text-muted-foreground text-sm'>未找到图标</div>
            ) : (
              <div className='grid grid-cols-8 gap-2'>
                {filteredIcons.map((iconName) => {
                  const Icon = (LucideIcons as unknown as Record<string, IconComponent>)[iconName]
                  if (!Icon) return null

                  const isSelected = value === iconName

                  return (
                    <button
                      key={iconName}
                      type='button'
                      onClick={() => handleSelect(iconName)}
                      className={cn(
                        'flex flex-col items-center justify-center rounded-md border p-2 transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        isSelected && 'border-primary bg-primary text-primary-foreground'
                      )}
                      title={iconName}
                    >
                      {React.createElement(Icon, { className: 'h-5 w-5' })}
                      <span className='mt-1 w-full truncate text-center text-[10px]'>{iconName}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        {value && (
          <div className='border-t p-2'>
            <Button type='button' variant='ghost' size='sm' className='w-full' onClick={handleClear}>
              清除图标
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
