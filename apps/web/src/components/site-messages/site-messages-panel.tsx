'use client'

import { Bell, Loader2, MailOpen } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@workspace/ui/components/pagination'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@workspace/ui/components/sheet'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { trpc } from '@/lib/trpc/client'
import { cn } from '@/lib/utils'
import { SiteMessageBody } from './site-message-body'

const PAGE_SIZE = 10

type ReadFilter = 'all' | 'unread' | 'read'

interface SiteMessagesPanelProps {
  buttonClassName?: string
}

/**
 * Notification bell plus the inbox it opens.
 *
 * The unread badge is polled on every page the header renders; the list itself
 * is only fetched while the sheet is open, so the count is cheap and the list
 * is not.
 */
export function SiteMessagesPanel({ buttonClassName }: SiteMessagesPanelProps) {
  const t = useTranslations('Dashboard.messages')
  const utils = trpc.useUtils()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const listContainerRef = useRef<HTMLDivElement>(null)

  const { data: unreadData } = trpc.siteMessages.unreadCount.useQuery(undefined, {
    // The header renders on every authenticated page; there is no signal that
    // a new message arrived, so poll slowly rather than never.
    refetchInterval: 60_000,
  })
  const unreadCount = unreadData?.count ?? 0

  const { data: listData, isLoading, isFetching } = trpc.siteMessages.list.useQuery(
    { page, pageSize: PAGE_SIZE, readFilter },
    { enabled: sheetOpen }
  )

  const { data: selectedMessage, isLoading: detailLoading } = trpc.siteMessages.getById.useQuery(
    { id: selectedMessageId ?? '' },
    { enabled: detailOpen && Boolean(selectedMessageId) }
  )

  const markReadMutation = trpc.siteMessages.markRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.siteMessages.list.invalidate(),
        utils.siteMessages.unreadCount.invalidate(),
        ...(selectedMessageId
          ? [utils.siteMessages.getById.invalidate({ id: selectedMessageId })]
          : []),
      ])
    },
  })

  const markAllReadMutation = trpc.siteMessages.markAllRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.siteMessages.list.invalidate(),
        utils.siteMessages.unreadCount.invalidate(),
      ])
    },
  })

  // A new page or filter should start at the top rather than keeping the
  // previous scroll offset.
  useEffect(() => {
    if (!sheetOpen) return
    listContainerRef.current?.scrollTo({ top: 0 })
  }, [page, readFilter, sheetOpen])

  // The unread badge is polled every 60s, so each completed poll re-renders
  // this component. Reading the clock there gives every row one shared
  // reference point, instead of each row reading its own and disagreeing about
  // whether a message is "just now".
  const now = unreadData?.polledAt ?? 0

  const messages = listData?.items ?? []
  const totalItems = listData?.total ?? 0
  const totalPages = listData?.totalPages ?? 0
  const start = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, totalItems)

  const closeOverlays = () => {
    setDetailOpen(false)
    setSheetOpen(false)
    setSelectedMessageId(null)
  }

  return (
    <>
      <Button
        variant='ghost'
        size='icon'
        className={cn('relative shrink-0 cursor-pointer', buttonClassName)}
        aria-label={t('ariaLabel')}
        onClick={() => setSheetOpen(true)}
      >
        <Bell className='size-5' />
        {unreadCount > 0 && (
          <Badge className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center bg-destructive px-1 text-white text-xs'>
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        )}
      </Button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side='right' className='flex h-full w-full min-w-[20vw] flex-col gap-0 p-0 sm:max-w-md'>
          <SheetHeader className='border-b px-4 py-4'>
            <div className='flex items-start justify-between gap-3 pr-8'>
              <div className='space-y-1'>
                <SheetTitle>{t('title')}</SheetTitle>
                <SheetDescription>
                  {unreadCount > 0 ? t('unreadCount', { count: unreadCount }) : t('noUnread')}
                </SheetDescription>
              </div>
              {unreadCount > 0 && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-8 shrink-0 cursor-pointer px-2 text-xs'
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                >
                  {markAllReadMutation.isPending ? (
                    <Loader2 className='mr-1 size-3.5 animate-spin' />
                  ) : (
                    <MailOpen className='mr-1 size-3.5' />
                  )}
                  {t('markAllRead')}
                </Button>
              )}
            </div>
          </SheetHeader>

          <div className='border-b px-4 py-3'>
            <Tabs
              value={readFilter}
              onValueChange={(value) => {
                setReadFilter(value as ReadFilter)
                setPage(1)
              }}
            >
              <TabsList className='grid w-full grid-cols-3'>
                <TabsTrigger value='all'>{t('filter.all')}</TabsTrigger>
                <TabsTrigger value='unread'>{t('filter.unread')}</TabsTrigger>
                <TabsTrigger value='read'>{t('filter.read')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div ref={listContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
            {isLoading ? (
              <div className='divide-y'>
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className='space-y-2 px-4 py-4'>
                    <Skeleton className='h-4 w-2/3' />
                    <Skeleton className='h-3 w-full' />
                    <Skeleton className='h-3 w-1/2' />
                  </div>
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className='flex flex-col items-center justify-center px-4 py-16 text-center'>
                <Bell className='mb-3 size-8 text-muted-foreground/40' />
                <p className='font-medium text-sm'>
                  {readFilter === 'unread'
                    ? t('emptyUnread')
                    : readFilter === 'read'
                      ? t('emptyRead')
                      : t('emptyAll')}
                </p>
                <p className='mt-1 text-muted-foreground text-xs'>{t('emptyHint')}</p>
              </div>
            ) : (
              <div className={cn('divide-y', isFetching && !isLoading && 'opacity-70')}>
                {messages.map((message) => (
                  <button
                    key={message.id}
                    type='button'
                    className={cn(
                      'flex w-full cursor-pointer flex-col gap-1 px-4 py-4 text-left transition-colors hover:bg-muted/50',
                      !message.read && 'bg-primary/5'
                    )}
                    onClick={() => {
                      setSelectedMessageId(message.id)
                      setDetailOpen(true)
                      markReadMutation.mutate({ id: message.id })
                    }}
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0 flex-1 space-y-1'>
                        <div className='flex items-center gap-2'>
                          {!message.read && (
                            <span className='size-2 shrink-0 rounded-full bg-primary' />
                          )}
                          <p
                            className={cn(
                              'truncate text-sm',
                              !message.read ? 'font-medium text-foreground' : 'text-foreground/90'
                            )}
                          >
                            {message.title}
                          </p>
                        </div>
                        <p className='line-clamp-2 text-muted-foreground text-xs leading-relaxed'>
                          {message.summary}
                        </p>
                      </div>
                      {message.category && (
                        <Badge variant='secondary' className='shrink-0 text-[10px]'>
                          {message.category}
                        </Badge>
                      )}
                    </div>
                    <p className='text-[11px] text-muted-foreground'>
                      <MessageTime iso={message.createdAt} now={now} />
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {totalItems > 0 && (
            <div className='flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
              <p className='text-muted-foreground text-sm'>
                {t('pagination.showing', { start, end, total: totalItems })}
              </p>
              {totalPages > 1 && (
                <Pagination className='mx-0 w-auto justify-end'>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        className={cn(
                          'cursor-pointer',
                          page <= 1 && 'pointer-events-none opacity-50'
                        )}
                        aria-disabled={page <= 1}
                      />
                    </PaginationItem>
                    {getPageNumbers(page, totalPages).map((pageNumber, index) =>
                      pageNumber === '...' ? (
                        <PaginationItem key={`ellipsis-${index}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={pageNumber}>
                          <PaginationLink
                            className={page === pageNumber ? '' : 'cursor-pointer'}
                            isActive={page === pageNumber}
                            onClick={() => setPage(pageNumber)}
                          >
                            {pageNumber}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext
                        className={cn(
                          'cursor-pointer',
                          page >= totalPages && 'pointer-events-none opacity-50'
                        )}
                        aria-disabled={page >= totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) setSelectedMessageId(null)
        }}
      >
        <DialogContent className='flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg'>
          {detailLoading ? (
            <div className='space-y-4 px-6 py-6'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='h-6 w-3/4' />
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-32 w-full' />
            </div>
          ) : selectedMessage ? (
            <>
              <DialogHeader className='space-y-3 border-b px-6 py-4 text-left'>
                <div className='flex flex-wrap items-center gap-2'>
                  {selectedMessage.category && <Badge variant='secondary'>{selectedMessage.category}</Badge>}
                  <span className='text-muted-foreground text-xs'>
                    <MessageTime iso={selectedMessage.createdAt} now={now} />
                  </span>
                </div>
                <DialogTitle className='text-base leading-snug'>{selectedMessage.title}</DialogTitle>
                <DialogDescription className='text-sm leading-relaxed'>
                  {selectedMessage.summary}
                </DialogDescription>
              </DialogHeader>

              <div className='min-h-0 flex-1 overflow-y-auto'>
                <div className='px-6 py-4'>
                  <SiteMessageBody
                    content={selectedMessage.content}
                    links={selectedMessage.links}
                    onInternalNavigate={closeOverlays}
                  />
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Page numbers with ellipses, e.g. `[1, 2, 3, '…', 8, 9, 10]`.
 */
function getPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 3) {
    return [1, 2, 3, '...', totalPages - 1, totalPages]
  }

  if (currentPage >= totalPages - 2) {
    return [1, 2, '...', totalPages - 2, totalPages - 1, totalPages]
  }

  return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages]
}

/**
 * Relative time for the last week, absolute date beyond that.
 *
 * `now` is passed in rather than read from `Date.now()` inline: a timestamp read
 * during render makes the output depend on when React happened to re-render, so
 * two renders of the same list could disagree about whether a message is
 * "just now". The parent reads the clock once per render pass and shares it.
 */
function MessageTime({ iso, now }: { iso: string; now: number }) {
  const t = useTranslations('Dashboard.messages')
  const format = useFormatter()

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return <>{iso}</>

  const diffMinutes = Math.floor((now - date.getTime()) / (60_000))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return <>{t('time.justNow')}</>
  if (diffMinutes < 60) return <>{t('time.minutesAgo', { count: diffMinutes })}</>
  if (diffHours < 24) return <>{t('time.hoursAgo', { count: diffHours })}</>
  if (diffDays < 7) return <>{t('time.daysAgo', { count: diffDays })}</>

  return (
    <>
      {format.dateTime(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </>
  )
}
