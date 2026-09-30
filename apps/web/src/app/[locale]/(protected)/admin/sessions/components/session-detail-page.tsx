'use client'

import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  CopyIcon,
  MonitorIcon,
  RefreshCwIcon,
  UserRoundIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Separator } from '@workspace/ui/components/separator'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils'
import { RevokeSessionDialog } from '../components/revoke-session-dialog'
import type { AdminSessionDetail } from '../types'

/**
 * Session detail.
 *
 * `expiresAt` is editable because extending a session is a real support task.
 * The IP address and user agent are shown read-only: they are the evidence
 * used to judge whether a session was stolen, and the router deliberately
 * refuses to overwrite them.
 */
export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const { data, isLoading, error } = trpc.admin.sessions.getSessionById.useQuery(
    { id: sessionId },
    { enabled: !!sessionId }
  )

  const [expiresAt, setExpiresAt] = useState('')
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Seed the editor when a *different* session is loaded. Keyed on the id alone
  // so a background refetch cannot discard an edit in progress: `expiresAt` is
  // a fresh `Date` on every response and would re-trigger this on every refetch.
  const seededIdRef = useRef<string | null>(null)
  const loadedId = data?.success && data.data ? data.data.id : null
  const loadedExpiresAt = data?.success && data.data ? data.data.expiresAt : null
  useEffect(() => {
    if (loadedId === null || loadedExpiresAt === null) return
    if (seededIdRef.current === loadedId) return
    seededIdRef.current = loadedId
    setExpiresAt(toLocalInputValue(loadedExpiresAt))
    setDirty(false)
  }, [loadedId, loadedExpiresAt])

  const updateMutation = trpc.admin.sessions.updateSession.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('会话有效期已更新')
        setDirty(false)
        await utils.admin.sessions.getSessionById.invalidate({ id: sessionId })
        await utils.admin.sessions.getSessions.invalidate()
        await utils.admin.sessions.getSessionsStats.invalidate()
      } else {
        toast.error(result.error)
      }
    },
    onError: (err) => toast.error(err.message || '更新失败'),
  })

  const revokeMutation = trpc.admin.sessions.deleteSession.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('会话已吊销')
        await utils.admin.sessions.getSessions.invalidate()
        await utils.admin.sessions.getSessionsStats.invalidate()
        router.push('/admin/sessions')
      }
    },
    onError: (err) => toast.error(err.message || '吊销会话失败'),
  })

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <Skeleton className='h-8 w-40' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  if (error || !data?.success || !data.data) {
    return (
      <div className='flex flex-col items-center gap-4 py-20'>
        <h1 className='font-bold text-2xl text-destructive'>会话不存在</h1>
        <p className='text-muted-foreground'>该会话可能已被吊销或清理</p>
        <Button variant='outline' onClick={() => router.push('/admin/sessions')}>
          <ArrowLeftIcon className='mr-2 h-4 w-4' />
          返回会话列表
        </Button>
      </div>
    )
  }

  const session = data.data as AdminSessionDetail

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center gap-4'>
        <Button variant='ghost' size='sm' onClick={() => router.push('/admin/sessions')}>
          <ArrowLeftIcon className='mr-2 h-4 w-4' />
          返回
        </Button>
        <div className='flex items-center gap-2'>
          <MonitorIcon className='h-5 w-5' />
          <h1 className='font-bold text-2xl tracking-tight'>会话详情</h1>
          <Badge variant='outline' className='w-fit px-1.5'>
            {session.active ? '活跃' : '已过期'}
          </Badge>
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <Card>
            <CardHeader>
              <CardTitle>会话信息</CardTitle>
              <CardDescription>登录上下文与会话生命周期</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <p className='font-medium text-muted-foreground text-sm'>会话 ID</p>
                  <div className='flex items-center gap-2'>
                    <p className='font-mono break-all text-sm'>{session.id}</p>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-7 w-7 shrink-0 cursor-pointer'
                      onClick={() => {
                        navigator.clipboard.writeText(session.id)
                        toast.success('已复制会话 ID')
                      }}
                    >
                      <CopyIcon className='h-3.5 w-3.5' />
                    </Button>
                  </div>
                </div>

                <div className='space-y-2'>
                  <p className='font-medium text-muted-foreground text-sm'>所属用户</p>
                  {session.userId ? (
                    <Link
                      href={`/admin/users/${session.userId}`}
                      className='flex items-center gap-1.5 text-sm hover:underline hover:underline-offset-4'
                    >
                      <UserRoundIcon className='h-3.5 w-3.5' />
                      {session.userName || session.userEmail || '未命名用户'}
                    </Link>
                  ) : (
                    <p className='text-muted-foreground text-sm'>未知用户（用户可能已删除）</p>
                  )}
                  {session.userEmail && (
                    <p className='text-muted-foreground text-xs'>{session.userEmail}</p>
                  )}
                </div>

                <div className='space-y-2'>
                  <p className='font-medium text-muted-foreground text-sm'>IP 地址</p>
                  <p className='font-mono text-sm'>{session.ipAddress ?? '未记录'}</p>
                </div>

                <div className='space-y-2'>
                  <p className='font-medium text-muted-foreground text-sm'>创建时间</p>
                  <p className='flex items-center gap-1 text-sm'>
                    <CalendarIcon className='h-3 w-3' />
                    {formatDateTime(session.createdAt)}
                  </p>
                </div>

                <div className='space-y-2'>
                  <p className='font-medium text-muted-foreground text-sm'>最后活动</p>
                  <p className='flex items-center gap-1 text-sm'>
                    <RefreshCwIcon className='h-3 w-3' />
                    {formatDateTime(session.updatedAt)}
                  </p>
                </div>

                <div className='space-y-2'>
                  <p className='font-medium text-muted-foreground text-sm'>过期时间</p>
                  <p className='flex items-center gap-1 text-sm'>
                    <ClockIcon className='h-3 w-3' />
                    {formatDateTime(session.expiresAt)}
                  </p>
                </div>
              </div>

              <Separator />

              <div className='space-y-2'>
                <p className='font-medium text-muted-foreground text-sm'>用户代理</p>
                <p className='rounded-md border bg-muted/40 p-3 font-mono break-all text-xs'>
                  {session.userAgent || '未记录'}
                </p>
                <p className='text-muted-foreground text-xs'>
                  IP 地址和用户代理为只读。它们是判断会话是否被盗用的依据，不允许在控制台改写。
                </p>
              </div>

              <Separator />

              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='expires-at'>调整过期时间</Label>
                  {dirty && (
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-6 cursor-pointer text-xs'
                      onClick={() => {
                        setExpiresAt(toLocalInputValue(session.expiresAt))
                        setDirty(false)
                      }}
                    >
                      撤销修改
                    </Button>
                  )}
                </div>
                <div className='flex flex-wrap items-center gap-2'>
                  <Input
                    id='expires-at'
                    type='datetime-local'
                    value={expiresAt}
                    onChange={(event) => {
                      setExpiresAt(event.target.value)
                      setDirty(true)
                    }}
                    className='w-64'
                  />
                  <Button
                    onClick={() => {
                      if (!expiresAt) {
                        toast.error('请选择过期时间')
                        return
                      }
                      updateMutation.mutate({
                        id: session.id,
                        expiresAt: new Date(expiresAt).toISOString(),
                      })
                    }}
                    disabled={!dirty || updateMutation.isPending}
                  >
                    {updateMutation.isPending ? '保存中...' : '保存'}
                  </Button>
                  <Button
                    variant='outline'
                    onClick={() => {
                      const next = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                      setExpiresAt(toLocalInputValue(next))
                      setDirty(true)
                    }}
                  >
                    延长 7 天
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>管理操作</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant='destructive'
                className='w-full justify-start'
                onClick={() => setRevokeOpen(true)}
                disabled={revokeMutation.isPending}
              >
                <MonitorIcon className='mr-2 h-4 w-4' />
                吊销此会话
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <RevokeSessionDialog
        session={session}
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        onConfirm={() => revokeMutation.mutate({ id: session.id })}
        isLoading={revokeMutation.isPending}
      />
    </div>
  )
}

/**
 * Format a date for `<input type="datetime-local">`, which expects local time
 * with no timezone suffix. `toISOString()` would be UTC and silently shift the
 * stored value by the viewer's offset.
 */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
