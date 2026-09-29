'use client'

import { Badge } from '@workspace/ui/components/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Boxes, ShieldCheck, Zap } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { authLabel, hostingLabel, transportLabel } from '@/lib/registry-labels'
import { Routes } from '@/lib/routes'

export interface McpServerCardData {
  id: string
  name: string
  description: string
  transport: string
  hosting: string
  authType: string | null
  categoryName: string | null
  price: { paid: boolean; label: string }
  downloads: number
  certified: boolean
}

export function McpServerCard({ server }: { server: McpServerCardData }) {
  const t = useTranslations('McpPage')
  // `registry-labels` only branches on zh/en, so normalize the BCP-47 tag.
  const lang = useLocale() === 'zh' ? 'zh' : 'en'

  return (
    <LocaleLink href={`${Routes.MCP}/${server.id}`} className='group block h-full' prefetch={false}>
      <Card className='h-full transition-colors group-hover:border-primary/50'>
        <CardHeader className='grow'>
          <div className='flex items-center justify-between'>
            <Boxes className='h-6 w-6 shrink-0 text-primary' />
            <div className='flex items-center gap-2'>
              {server.certified && <ShieldCheck className='h-5 w-5 shrink-0 text-green-600' />}
              <Badge variant='outline' className='text-xs'>
                {transportLabel(server.transport, lang)}
              </Badge>
            </div>
          </div>
          <CardTitle
            className='line-clamp-1 text-lg transition-colors group-hover:text-primary'
            title={server.name}
          >
            {server.name}
          </CardTitle>
          <CardDescription className='line-clamp-3 min-h-[3.75rem]'>
            {server.description || t('card.noDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex min-h-[3.5rem] flex-wrap content-start gap-2'>
            <span className='rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs'>
              {hostingLabel(server.hosting, lang)}
            </span>
            {server.authType && (
              <span className='rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs'>
                {authLabel(server.authType, lang)}
              </span>
            )}
            {server.categoryName && (
              <span className='rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs'>
                {server.categoryName}
              </span>
            )}
            <span
              className={
                server.price.paid
                  ? 'rounded-full bg-primary/10 px-2.5 py-1 text-primary text-xs'
                  : 'rounded-full bg-green-100 px-2.5 py-1 text-green-700 text-xs dark:bg-green-950 dark:text-green-400'
              }
            >
              {server.price.label}
            </span>
            {server.downloads > 0 && (
              <span className='rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs'>
                <Zap className='mr-0.5 inline h-3 w-3' />
                {t('card.calls', { count: server.downloads })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </LocaleLink>
  )
}
