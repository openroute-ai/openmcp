'use client'

import { Calendar, Check, Copy, Download, ExternalLink, Eye, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@workspace/ui/components/avatar'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { useTranslations } from 'next-intl'
import { LocaleLink } from '@/i18n/navigation'
import { authClient } from '@/lib/auth-client'
import { Routes } from '@/lib/routes'
import { trpc } from '@/lib/trpc/client'
import type { WorkflowDetailData } from './types'

interface WorkflowDetailSidebarProps {
  workflow: Pick<
    WorkflowDetailData,
    'id' | 'workflowId' | 'author' | 'nodes' | 'categories' | 'stats' | 'workflowUrl' | 'certified'
  >
}

export function WorkflowDetailSidebar({ workflow }: WorkflowDetailSidebarProps) {
  const t = useTranslations('Workflows')
  const callbackUrl = `/workflows/${workflow.workflowId ?? workflow.id}`
  const [copied, setCopied] = useState(false)
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false)

  const { data: session } = authClient.useSession()
  const isLoggedIn = !!session?.user

  const utils = trpc.useUtils()

  const downloadMutation = trpc.workflows.downloadWorkflow.useMutation({
    onSuccess: () => {
      toast.success(t('detail.downloadSuccess'))
      // 刷新工作流数据以更新下载次数
      utils.workflows.getWorkflowById.invalidate()
    },
    onError: (error) => {
      toast.error(error.message || t('detail.downloadError'))
    },
  })

  const handleCopyId = async () => {
    // 检查用户是否已登录
    if (!isLoggedIn) {
      setIsLoginDialogOpen(true)
      return
    }

    try {
      await navigator.clipboard.writeText(workflow.id.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy ID:', err)
    }
  }

  const handleDownload = async () => {
    // 检查用户是否已登录
    if (!isLoggedIn) {
      setIsLoginDialogOpen(true)
      return
    }

    if (!workflow.workflowId) {
      toast.error(t('detail.missingId'))
      return
    }

    downloadMutation.mutate({
      workflowId: workflow.workflowId,
      ipAddress: undefined, // 可以从请求头获取
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
    })
  }

  return (
    <div className='space-y-6 mb-4'>
      {/* Author Section */}
      <div className='rounded-lg border border-border bg-card p-6 shadow-sm'>
        <div className='mb-6'>
          <div className='mb-4 flex items-start justify-between'>
            {/* Author Info */}
            <div className='flex items-start'>
              <Avatar className='mr-4 h-12 w-12'>
                <AvatarImage src={workflow.author.avatar || undefined} alt={workflow.author.name} />
                <AvatarFallback className='text-sm'>{workflow.author.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <div className='flex items-center gap-1'>
                  <LocaleLink
                    href={`/authors/${workflow.author.username}`}
                    className='font-medium text-foreground transition-colors hover:text-primary'
                  >
                    {workflow.author.name}
                  </LocaleLink>
                  {workflow.author.verified && <Sparkles className='h-4 w-4 text-blue-500' fill='currentColor' />}
                </div>
                <p className='text-muted-foreground text-sm'>@{workflow.author.username}</p>
              </div>
            </div>
            {/* Workflow Count */}
            <span className='inline-flex items-center whitespace-nowrap rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-primary text-xs'>
              {workflow.author.workflowCount} {t('workflowCount')}
            </span>
          </div>

          {/* Author Bio */}
          {workflow.author.bio && <p className='mb-3 text-muted-foreground text-sm'>{workflow.author.bio}</p>}

          {/* Author Links */}
          {(workflow.author.website || workflow.author.twitter) && (
            <div className='flex gap-2 text-sm'>
              {workflow.author.website && (
                <a
                  href={workflow.author.website}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-primary hover:underline'
                >
                  {t('detail.website')}
                </a>
              )}
              {workflow.author.twitter && (
                <a
                  href={workflow.author.twitter}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-primary hover:underline'
                >
                  Twitter
                </a>
              )}
            </div>
          )}
        </div>

        {/* Nodes Section */}
        <div className='mb-6'>
          <h3 className='mb-3 font-semibold text-foreground text-sm'>{t('detail.nodes')}</h3>
          <div className='flex flex-wrap gap-2'>
            {workflow.nodes.map((node, index) => (
              <Badge key={index} variant='outline' className='text-xs'>
                {node.split('.').pop()}
              </Badge>
            ))}
          </div>
        </div>

        {/* Categories Section */}
        <div className='mb-6'>
          <h3 className='mb-3 font-semibold text-foreground text-sm'>{t('detail.categories')}</h3>
          <div className='flex flex-wrap gap-2'>
            {workflow.categories.map((category, index) => (
              <Badge key={index} variant='secondary' className='text-xs'>
                {category}
              </Badge>
            ))}
          </div>
        </div>

        {/* Stats Section */}
        <div className='mb-6 space-y-3 text-sm'>
          <div className='flex items-center justify-between'>
            <span className='flex items-center text-muted-foreground'>
              <Calendar className='mr-2 h-4 w-4' />
              {t('createdAt')}
            </span>
            <span className='font-medium'>{workflow.stats.created}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='flex items-center text-muted-foreground'>
              <Calendar className='mr-2 h-4 w-4' />
              {t('updatedAt')}
            </span>
            <span className='font-medium'>{workflow.stats.updated}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='flex items-center text-muted-foreground'>
              <Eye className='mr-2 h-4 w-4' />
              {t('views')}
            </span>
            <span className='font-medium'>{workflow.stats.views}</span>
          </div>
          <div className='flex items-center justify-between'>
            <span className='flex items-center text-muted-foreground'>
              <Download className='mr-2 h-4 w-4' />
              {t('downloads')}
            </span>
            <span className='font-medium'>{workflow.stats.downloads}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className='space-y-3'>
          {/* Copy ID Button */}
          <Button
            onClick={handleCopyId}
            variant={copied ? 'default' : 'outline'}
            className='w-full justify-center'
            disabled={copied}
          >
            {copied ? (
              <>
                <Check className='mr-2 h-4 w-4' />
                {t('detail.copied')}
              </>
            ) : (
              <>
                <Copy className='mr-2 h-4 w-4' />
                {t('detail.copyId')}
              </>
            )}
          </Button>

          {/* View on n8n.io Button */}
          {isLoggedIn && (
            <Button asChild variant='outline' className='w-full justify-center bg-transparent'>
              <a href={workflow.workflowUrl} target='_blank' rel='noopener noreferrer'>
                <ExternalLink className='mr-2 h-4 w-4' />{t('detail.viewOnN8n')}
              </a>
            </Button>
          )}

          {/* Download Button */}
          <Button onClick={handleDownload} className='w-full justify-center' disabled={downloadMutation.isPending}>
            {downloadMutation.isPending ? (
              <>
                <svg
                  className='mr-2 h-4 w-4 animate-spin'
                  xmlns='http://www.w3.org/2000/svg'
                  fill='none'
                  viewBox='0 0 24 24'
                >
                  <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
                  <path
                    className='opacity-75'
                    fill='currentColor'
                    d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                  />
                </svg>
                {t('detail.downloading')}
              </>
            ) : (
              <>
                <Download className='mr-2 h-4 w-4' />
                {t('detail.downloadWorkflow')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Certified Badge */}
      {workflow.certified && (
        <div className='rounded-lg border border-primary/20 bg-primary/10 p-4 text-center'>
          <Sparkles className='mx-auto mb-2 h-8 w-8 text-primary' fill='currentColor' />
          <p className='font-medium text-primary text-sm'>{t('detail.certifiedTitle')}</p>
          <p className='mt-1 text-muted-foreground text-xs'>{t('detail.certifiedDescription')}</p>
        </div>
      )}

      {/*
       * The upstream app rendered a full login form in this dialog. Auth lives
       * on /sign-in in this app, so unauthenticated actions route there instead.
       */}
      <Dialog open={isLoginDialogOpen} onOpenChange={setIsLoginDialogOpen}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>{t('detail.signInRequired')}</DialogTitle>
          </DialogHeader>
          <Button asChild onClick={() => setIsLoginDialogOpen(false)}>
            <LocaleLink href={`${Routes.Login}?callbackUrl=${encodeURIComponent(callbackUrl)}`}>
              {t('detail.signIn')}
            </LocaleLink>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
