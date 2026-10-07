'use client'

import { useTranslations } from 'next-intl'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { RecentDownloadsList, type RecentDownload } from '@/components/dashboard/recent-downloads-list'
import { RecentFavoritesList, type RecentFavorite } from '@/components/dashboard/recent-favorites-list'

interface RecentActivityTabsProps {
  downloads?: RecentDownload[]
  favorites?: RecentFavorite[]
  isLoading?: boolean
  error?: Error | null
}

/**
 * 消费侧动态：最近下载 / 最近收藏收进同一张卡的两个 Tab。
 *
 * 创作者视图也复用它 —— 创作者同样在消费内容，把消费数据藏起来会让
 * 「同一账号两个身份」变成两个割裂的产品。
 */
export function RecentActivityTabs({ downloads, favorites, isLoading = false, error = null }: RecentActivityTabsProps) {
  const t = useTranslations('Dashboard')

  return (
    <Tabs defaultValue='downloads'>
      <TabsList>
        <TabsTrigger value='downloads'>{t('overview.tabs.downloads')}</TabsTrigger>
        <TabsTrigger value='favorites'>{t('overview.tabs.favorites')}</TabsTrigger>
      </TabsList>
      <TabsContent value='downloads'>
        <RecentDownloadsList data={downloads} isLoading={isLoading} error={error} />
      </TabsContent>
      <TabsContent value='favorites'>
        <RecentFavoritesList data={favorites} isLoading={isLoading} error={error} />
      </TabsContent>
    </Tabs>
  )
}
