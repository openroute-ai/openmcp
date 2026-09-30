'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { useLocalePathname, useLocaleRouter } from '@/i18n/navigation'

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  const pathname = useLocalePathname()
  const router = useLocaleRouter()
  const [activeTab, setActiveTab] = useState('posts')

  useEffect(() => {
    if (!pathname) return

    if (pathname.includes('/admin/blog/authors')) {
      setActiveTab('authors')
    } else if (pathname.includes('/admin/blog/categories')) {
      setActiveTab('categories')
    } else {
      setActiveTab('posts')
    }
  }, [pathname])

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    if (value === 'posts') {
      router.push('/admin/blog')
    } else if (value === 'authors') {
      router.push('/admin/blog/authors')
    } else if (value === 'categories') {
      router.push('/admin/blog/categories')
    }
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>博客管理</h1>
          <p className='text-muted-foreground'>管理系统中的博客文章、作者和分类</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value='posts'>文章</TabsTrigger>
          <TabsTrigger value='authors'>作者</TabsTrigger>
          <TabsTrigger value='categories'>分类</TabsTrigger>
        </TabsList>
      </Tabs>

      <div>{children}</div>
    </div>
  )
}
