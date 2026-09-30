'use client'

import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  MailCheckIcon,
  MailQuestionIcon,
  MonitorIcon,
  ShieldIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Separator } from '@workspace/ui/components/separator'
import { Skeleton } from '@workspace/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@workspace/ui/components/table'
import { UserAvatar } from '@/components/layout/user-avatar'
import { trpc } from '@/lib/trpc/client'
import { formatDateTime } from '@/lib/utils'
import { BanUserDialog } from '../components/ban-user-dialog'
import type { AdminUserDetail } from '../types'

/**
 * User detail.
 *
 * Every action here is wired to a real mutation. The source page also showed
 * "发送验证邮件", "重置密码" and "权限管理" buttons, none of which had a
 * handler; this page offers role changes and session revocation instead, both
 * of which the router implements, and links to the session console rather than
 * pretending to revoke sessions from here.
 */
export function UserDetailPage({ userId }: { userId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const { data, isLoading, error } = trpc.admin.users.getUserById.useQuery(
    { id: userId },
    { enabled: !!userId }
  )

  const { data: sessionsData, isLoading: sessionsLoading } =
    trpc.admin.sessions.getSessionsByUserId.useQuery({ userId, limit: 10 }, { enabled: !!userId })

  const [banOpen, setBanOpen] = useState(false)

  const roleMutation = trpc.admin.users.updateUserRole.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('角色已更新')
        await utils.admin.users.getUserById.invalidate({ id: userId })
        await utils.admin.users.listUsers.invalidate()
      } else {
        toast.error(result.error)
      }
    },
    onError: (err) => toast.error(err.message || '更新角色失败'),
  })

  const revokeAllMutation = trpc.admin.sessions.deleteSessionsByUserId.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        toast.success(`已吊销 ${result.data.revoked} 个会话`)
        await utils.admin.sessions.getSessionsByUserId.invalidate({ userId })
        await utils.admin.sessions.getSessions.invalidate()
      }
    },
    onError: (err) => toast.error(err.message || '吊销会话失败'),
  })

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <div className='flex items-center gap-4'>
          <Skeleton className='size-12' />
          <div className='space-y-2'>
            <Skeleton className='h-6 w-40' />
            <Skeleton className='h-4 w-56' />
          </div>
        </div>
        <div className='grid gap-6'>
          <Skeleton className='h-64 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      </div>
    )
  }

  if (error || !data?.success || !data.data) {
    return (
      <div className='flex flex-col items-center gap-4 py-20'>
        <h1 className='font-bold text-2xl text-destructive'>用户不存在</h1>
        <p className='text-muted-foreground'>无法找到指定的用户信息</p>
        <Button variant='outline' onClick={() => router.back()}>
          <ArrowLeftIcon className='mr-2 h-4 w-4' />
          返回
        </Button>
      </div>
    )
  }

  const user = data.data as AdminUserDetail
  const sessions = sessionsData?.success ? sessionsData.data : []

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center gap-4'>
        <Button variant='ghost' size='sm' onClick={() => router.push('/admin/users')}>
          <ArrowLeftIcon className='mr-2 h-4 w-4' />
          返回
        </Button>
        <div className='flex items-center gap-4'>
          <UserAvatar name={user.name} image={user.image} className='size-12 border' />
          <div>
            <h1 className='font-bold text-2xl'>{user.name || '未命名'}</h1>
            <p className='text-muted-foreground'>{user.email ?? '未设置邮箱'}</p>
          </div>
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='space-y-6 lg:col-span-2'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <UserRoundCheckIcon className='h-5 w-5' />
                用户信息
              </CardTitle>
              <CardDescription>用户的基本信息和状态</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex flex-wrap gap-2'>
                <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
                  {user.role === 'admin' ? '管理员' : '用户'}
                </Badge>
                <Badge variant='outline' className='flex items-center gap-1'>
                  {user.emailVerified ? (
                    <MailCheckIcon className='h-3 w-3 text-green-500' />
                  ) : (
                    <MailQuestionIcon className='h-3 w-3 text-red-500' />
                  )}
                  {user.emailVerified ? '邮箱已验证' : '邮箱未验证'}
                </Badge>
                <Badge variant='outline' className='flex items-center gap-1'>
                  {user.banned ? (
                    <UserRoundXIcon className='h-3 w-3 text-red-500' />
                  ) : (
                    <UserRoundCheckIcon className='h-3 w-3 text-green-500' />
                  )}
                  {user.banned ? '已封禁' : '正常'}
                </Badge>
                {user.phoneNumberVerified && (
                  <Badge variant='outline' className='flex items-center gap-1'>
                    <CheckCircleIcon className='h-3 w-3 text-green-500' />
                    手机已验证
                  </Badge>
                )}
              </div>

              <Separator />

              <div className='grid gap-4 md:grid-cols-2'>
                <Field label='用户 ID'>
                  <p className='font-mono text-sm'>{user.id}</p>
                </Field>
                <Field label='邮箱'>
                  <p className='text-sm'>{user.email || '未设置'}</p>
                </Field>
                <Field label='手机号'>
                  <p className='text-sm'>{user.phoneNumber || '未设置'}</p>
                </Field>
                <Field label='支付客户 ID'>
                  <p className='text-sm'>{user.customerId || '未设置'}</p>
                </Field>
                <Field label='充值订单'>
                  <p className='text-sm'>
                    {user.orderCount} 单（已支付 {user.paidOrderCount} 单）
                  </p>
                </Field>
                <Field label='累计充值'>
                  <p className='text-sm'>¥{user.paidAmount}</p>
                </Field>
                <Field label='创建时间'>
                  <p className='flex items-center gap-1 text-sm'>
                    <CalendarIcon className='h-3 w-3' />
                    {formatDateTime(user.createdAt)}
                  </p>
                </Field>
                <Field label='更新时间'>
                  <p className='flex items-center gap-1 text-sm'>
                    <ClockIcon className='h-3 w-3' />
                    {formatDateTime(user.updatedAt)}
                  </p>
                </Field>
              </div>

              {user.banned && (
                <>
                  <Separator />
                  <div className='space-y-2'>
                    <p className='font-medium text-destructive text-sm'>封禁信息</p>
                    <p className='text-sm'>
                      <span className='font-medium'>封禁原因：</span>
                      {user.banReason || '未指定'}
                    </p>
                    <p className='text-sm'>
                      <span className='font-medium'>封禁到期：</span>
                      {user.banExpires ? formatDateTime(user.banExpires) : '永久'}
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <MonitorIcon className='h-5 w-5' />
                最近会话
              </CardTitle>
              <CardDescription>该用户最近的登录会话</CardDescription>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className='space-y-2'>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className='h-12 w-full' />
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <p className='py-4 text-center text-muted-foreground'>暂无会话记录</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP 地址</TableHead>
                      <TableHead>用户代理</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>过期时间</TableHead>
                      <TableHead>状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className='font-mono text-sm'>{item.ipAddress ?? '-'}</TableCell>
                        <TableCell className='max-w-xs truncate text-sm' title={item.userAgent ?? ''}>
                          {item.userAgent || '-'}
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-sm'>
                          {formatDateTime(item.createdAt)}
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-sm'>
                          {formatDateTime(item.expiresAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline' className='flex w-fit items-center gap-1'>
                            {item.active ? (
                              <CheckCircleIcon className='h-3 w-3 text-green-500' />
                            ) : (
                              <ClockIcon className='h-3 w-3 text-muted-foreground' />
                            )}
                            {item.active ? '活跃' : '已过期'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <ShieldIcon className='h-5 w-5' />
                管理操作
              </CardTitle>
              <CardDescription>封禁和角色变更会立即生效</CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <Button
                variant='outline'
                className='w-full justify-start'
                disabled={roleMutation.isPending || user.role === 'admin'}
                onClick={() => roleMutation.mutate({ userId: user.id, role: 'admin' })}
              >
                <ShieldIcon className='mr-2 h-4 w-4' />
                设为管理员
              </Button>
              <Button
                variant='outline'
                className='w-full justify-start'
                disabled={roleMutation.isPending || user.role !== 'admin'}
                onClick={() => roleMutation.mutate({ userId: user.id, role: 'user' })}
              >
                <UserRoundCheckIcon className='mr-2 h-4 w-4' />
                降级为普通用户
              </Button>

              <Separator />

              {user.banned ? (
                <Button variant='default' className='w-full justify-start' onClick={() => setBanOpen(true)}>
                  <UserRoundCheckIcon className='mr-2 h-4 w-4' />
                  解除封禁
                </Button>
              ) : (
                <Button variant='destructive' className='w-full justify-start' onClick={() => setBanOpen(true)}>
                  <UserRoundXIcon className='mr-2 h-4 w-4' />
                  封禁用户
                </Button>
              )}

              <Button
                variant='outline'
                className='w-full justify-start'
                disabled={revokeAllMutation.isPending || sessions.length === 0}
                onClick={() => revokeAllMutation.mutate({ userId: user.id })}
              >
                <MonitorIcon className='mr-2 h-4 w-4' />
                吊销全部会话
              </Button>

              <Button variant='ghost' className='w-full justify-start' asChild>
                <Link href={`/admin/sessions?search=${encodeURIComponent(user.email ?? '')}`}>
                  在会话控制台查看
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <BanUserDialog
        target={{
          id: user.id,
          name: user.name || '未命名',
          email: user.email ?? '未设置邮箱',
          banned: user.banned,
        }}
        open={banOpen}
        onOpenChange={setBanOpen}
        onSuccess={() => {
          utils.admin.users.getUserById.invalidate({ id: userId })
        }}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='space-y-2'>
      <p className='font-medium text-muted-foreground text-sm'>{label}</p>
      {children}
    </div>
  )
}
