'use client'

import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Download,
  ExternalLink,
  FolderOpen,
  Monitor,
  Package,
  XCircle,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LocaleLink } from '@/i18n/navigation'
import { trpc } from '@/lib/trpc/client'

type SkillInstall = {
  id: string
  skillId: string
  runtime: string
  installPath: string | null
  status: string
  installedAt: Date
  lastUsedAt: Date | null
  skillTitle: string | null
  skillSlug: string | null
  skillVersion: string | null
  securityGrade: string | null
  skillExists: boolean
}

const RUNTIMES = ['cursor', 'claude-code', 'codex', 'generic'] as const
type Runtime = (typeof RUNTIMES)[number]

const runtimeBadgeClass: Record<Runtime, string> = {
  cursor: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  'claude-code':
    'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300',
  codex:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300',
  generic:
    'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300',
}

const runtimeIconClass: Record<Runtime, string> = {
  cursor: 'text-blue-600 dark:text-blue-400',
  'claude-code': 'text-purple-600 dark:text-purple-400',
  codex: 'text-green-600 dark:text-green-400',
  generic: 'text-gray-600 dark:text-gray-400',
}

function isRuntime(value: string): value is Runtime {
  return (RUNTIMES as readonly string[]).includes(value)
}

/** Install history for the signed-in user, filterable by runtime and status. */
export function SkillInstallsList() {
  const t = useTranslations('Dashboard.myInstalls')
  const locale = useLocale()
  const dateFnsLocale = locale === 'zh' ? zhCN : enUS

  const [runtimeFilter, setRuntimeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const utils = trpc.useUtils()
  const { data, isLoading, error } = trpc.skills.listMyInstalls.useQuery(undefined, {
    staleTime: 30_000,
  })
  const setStatus = trpc.skills.setMyInstallStatus.useMutation({
    onSuccess: () => {
      void utils.skills.listMyInstalls.invalidate()
    },
  })

  const installs = useMemo(() => (data?.success ? data.data : []) as SkillInstall[], [data])

  const filtered = useMemo(
    () =>
      installs.filter((install) => {
        if (runtimeFilter !== 'all' && install.runtime !== runtimeFilter) return false
        if (statusFilter !== 'all' && install.status !== statusFilter) return false
        return true
      }),
    [installs, runtimeFilter, statusFilter]
  )

  const handleToggleStatus = (install: SkillInstall) => {
    const next = install.status === 'active' ? 'removed' : 'active'
    if (next === 'removed' && !window.confirm(t('markRemovedConfirm'))) return

    setStatus.mutate(
      { installId: install.id, status: next },
      {
        onError: (mutationError) => toast.error(mutationError.message || t('updateFailed')),
      }
    )
  }

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
        <AlertDescription>{error.message || t('updateFailed')}</AlertDescription>
      </Alert>
    )
  }

  if (installs.length === 0) {
    return (
      <Card>
        <CardContent className='py-12 text-center'>
          <Package className='mx-auto mb-4 h-12 w-12 text-muted-foreground' />
          <p className='font-medium text-lg'>{t('empty.title')}</p>
          <p className='mt-2 text-muted-foreground text-sm'>{t('empty.description')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap gap-4'>
        <div className='flex items-center gap-2'>
          <label className='font-medium text-sm'>{t('filters.runtime')}</label>
          <Select value={runtimeFilter} onValueChange={setRuntimeFilter}>
            <SelectTrigger className='w-[150px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('filters.all')}</SelectItem>
              {RUNTIMES.map((runtime) => (
                <SelectItem key={runtime} value={runtime}>
                  {t(`filters.runtimes.${runtime}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex items-center gap-2'>
          <label className='font-medium text-sm'>{t('filters.status')}</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className='w-[150px]'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>{t('filters.all')}</SelectItem>
              <SelectItem value='active'>{t('filters.statuses.active')}</SelectItem>
              <SelectItem value='removed'>{t('filters.statuses.removed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='text-muted-foreground text-sm'>
        {filtered.length === installs.length
          ? t('count', { count: installs.length })
          : t('countFiltered', { count: filtered.length, total: installs.length })}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className='py-12 text-center text-muted-foreground text-sm'>{t('noMatch')}</CardContent>
        </Card>
      ) : (
        filtered.map((install) => {
          const runtime: Runtime = isRuntime(install.runtime) ? install.runtime : 'generic'
          return (
            <Card key={install.id}>
              <CardHeader>
                <div className='flex flex-wrap items-center gap-2'>
                  <CardTitle className='text-xl'>{install.skillTitle || t('unknownSkill')}</CardTitle>

                  <Badge variant='outline' className={runtimeBadgeClass[runtime]}>
                    <Monitor className='mr-1 h-3 w-3' />
                    {t(`filters.runtimes.${runtime}`)}
                  </Badge>

                  {install.status === 'active' ? (
                    <Badge
                      variant='outline'
                      className='border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                    >
                      <CheckCircle className='mr-1 h-3 w-3' />
                      {t('filters.statuses.active')}
                    </Badge>
                  ) : (
                    <Badge
                      variant='outline'
                      className='border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300'
                    >
                      <XCircle className='mr-1 h-3 w-3' />
                      {t('filters.statuses.removed')}
                    </Badge>
                  )}

                  {install.securityGrade === 'safe' && (
                    <Badge
                      variant='outline'
                      className='border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300'
                    >
                      {t('grade.safe')}
                    </Badge>
                  )}
                  {install.securityGrade === 'caution' && (
                    <Badge
                      variant='outline'
                      className='border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300'
                    >
                      {t('grade.caution')}
                    </Badge>
                  )}
                </div>

                <CardDescription className='mt-2 flex flex-col gap-2 text-sm'>
                  <div className='flex flex-wrap items-center gap-4'>
                    {install.skillVersion && (
                      <span className='flex items-center gap-1'>
                        <Package className='h-4 w-4' />v{install.skillVersion}
                      </span>
                    )}
                    <span className='flex items-center gap-1'>
                      <Calendar className='h-4 w-4' />
                      {t('installedAt', {
                        time: formatDistanceToNow(new Date(install.installedAt), {
                          addSuffix: true,
                          locale: dateFnsLocale,
                        }),
                      })}
                    </span>
                    {install.lastUsedAt && (
                      <span className='flex items-center gap-1'>
                        {t('lastUsedAt', {
                          time: formatDistanceToNow(new Date(install.lastUsedAt), {
                            addSuffix: true,
                            locale: dateFnsLocale,
                          }),
                        })}
                      </span>
                    )}
                  </div>

                  {install.installPath && (
                    <span className='flex items-center gap-1 text-muted-foreground text-xs'>
                      <FolderOpen className='h-3 w-3' />
                      {t('installPath')}: {install.installPath}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>

              <CardContent>
                {install.skillExists ? (
                  <div className='flex flex-wrap gap-2'>
                    <Button variant='outline' size='sm' asChild>
                      <LocaleLink href={`/skills/${install.skillSlug || install.skillId}`}>
                        <ExternalLink className='mr-2 h-4 w-4' />
                        {t('viewDetail')}
                      </LocaleLink>
                    </Button>

                    <Button variant='outline' size='sm' asChild>
                      <a href={`/api/skills/${install.skillSlug || install.skillId}/package`}>
                        <Download className='mr-2 h-4 w-4' />
                        {t('reinstall')}
                      </a>
                    </Button>

                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => handleToggleStatus(install)}
                      disabled={setStatus.isPending}
                    >
                      {install.status === 'active' ? (
                        <>
                          <XCircle className='mr-2 h-4 w-4' />
                          {t('markRemoved')}
                        </>
                      ) : (
                        <>
                          <CheckCircle className={runtimeIconClass[runtime]} />
                          {t('restore')}
                        </>
                      )}
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
          )
        })
      )}
    </div>
  )
}
