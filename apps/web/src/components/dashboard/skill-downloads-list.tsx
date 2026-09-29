'use client'

import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { AlertCircle, Calendar, Download, ExternalLink, Package } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'

type SkillDownload = {
  id: string
  skillId: string
  status: string
  downloadedAt: Date
  skillTitle: string | null
  skillSlug: string | null
  skillVersion: string | null
  securityGrade: string | null
  skillExists: boolean
}

/** Download history for the signed-in user, with re-download and detail links. */
export function SkillDownloadsList() {
  const t = useTranslations('Dashboard.myDownloads')
  const locale = useLocale()
  const { data, isLoading, error } = trpc.skills.listMyDownloads.useQuery(undefined, {
    staleTime: 30_000,
  })

  const downloads = (data?.success ? data.data : []) as SkillDownload[]

  if (isLoading) {
    return (
      <div className='space-y-4'>
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className='h-6 w-48' />
              <Skeleton className='h-4 w-32' />
            </CardHeader>
            <CardContent>
              <Skeleton className='h-4 w-full' />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant='destructive'>
        <AlertCircle className='h-4 w-4' />
        <AlertDescription>{error.message || t('loadFailed')}</AlertDescription>
      </Alert>
    )
  }

  if (downloads.length === 0) {
    return (
      <Card>
        <CardContent className='py-12 text-center'>
          <Package className='mx-auto mb-4 h-12 w-12 text-muted-foreground' />
          <p className='font-medium text-lg'>{t('empty.title')}</p>
          <p className='mt-2 text-muted-foreground text-sm'>
            <LocaleLink href='/skills' className='text-primary hover:underline'>
              {t('browseSkills')}
            </LocaleLink>
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='text-muted-foreground text-sm'>{t('count', { count: downloads.length })}</div>

      {downloads.map((download) => (
        <Card key={download.id}>
          <CardHeader>
            <div className='flex items-start justify-between'>
              <div className='flex-1'>
                <div className='flex items-center gap-2'>
                  <CardTitle className='text-xl'>{download.skillTitle || t('unknownSkill')}</CardTitle>
                  {download.securityGrade === 'safe' && (
                    <Badge
                      variant='outline'
                      className='border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                    >
                      {t('grade.safe')}
                    </Badge>
                  )}
                  {download.securityGrade === 'caution' && (
                    <Badge
                      variant='outline'
                      className='border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300'
                    >
                      {t('grade.caution')}
                    </Badge>
                  )}
                </div>
                <CardDescription className='mt-2 flex items-center gap-4 text-sm'>
                  {download.skillVersion && (
                    <span className='flex items-center gap-1'>
                      <Package className='h-4 w-4' />v{download.skillVersion}
                    </span>
                  )}
                  <span className='flex items-center gap-1'>
                    <Calendar className='h-4 w-4' />
                    {formatDistanceToNow(new Date(download.downloadedAt), {
                      addSuffix: true,
                      locale: locale === 'zh' ? zhCN : enUS,
                    })}
                  </span>
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {download.skillExists ? (
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' asChild>
                  <LocaleLink href={`/skills/${download.skillSlug || download.skillId}`}>
                    <ExternalLink className='mr-2 h-4 w-4' />
                    {t('viewDetail')}
                  </LocaleLink>
                </Button>
                <Button variant='outline' size='sm' asChild>
                  <a href={`/api/skills/${download.skillSlug || download.skillId}/package`}>
                    <Download className='mr-2 h-4 w-4' />
                    {t('downloadAgain')}
                  </a>
                </Button>
              </div>
            ) : (
              <Alert>
                <AlertCircle className='h-4 w-4' />
                <AlertDescription className='text-sm'>{t('skillRemoved')}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
