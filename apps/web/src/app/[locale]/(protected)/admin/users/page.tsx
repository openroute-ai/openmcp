'use client'

import { RefreshCw, SearchIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { useDebounce } from '@/hooks/use-debounce'
import { trpc } from '@/lib/trpc/client'
import { UserStatsCards } from './components/user-stats-cards'
import { UsersTable } from './components/users-table'
import { BanUserDialog, type BanTarget } from './components/ban-user-dialog'
import type { AdminUserRow, UserSortColumn } from './types'

/**
 * Admin user list.
 *
 * Filtering, sorting and pagination are all server-side: the router receives
 * `page`/`limit`/`sort` and returns one page. The source app instead paginated
 * a client-side table over a server page, which meant its page controls and
 * the rows on screen could disagree.
 */
export default function AdminUsersPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'all' | 'user' | 'admin'>('all')
  const [banned, setBanned] = useState<'all' | 'banned' | 'active'>('all')
  const [sort, setSort] = useState<UserSortColumn>('createdAt')
  const [sortDesc, setSortDesc] = useState(true)
  const [banTarget, setBanTarget] = useState<BanTarget | null>(null)

  const debouncedSearch = useDebounce(search, 400)

  const { data, isLoading, isFetching, error, refetch } = trpc.admin.users.listUsers.useQuery({
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    role,
    banned: banned === 'all' ? undefined : banned === 'banned',
    sort,
    sortDesc,
  })

  if (error) {
    toast.error(error.message || '加载用户列表失败')
  }

  const rows = (data?.success ? data.data.items : []) as AdminUserRow[]
  const total = data?.success ? data.data.total : 0

  // Toggling the active column flips direction, as an operator expects; a new
  // column starts descending for dates and ascending for names.
  const handleSortChange = (column: UserSortColumn) => {
    if (column === sort) {
      setSortDesc((prev) => !prev)
    } else {
      setSort(column)
      setSortDesc(column !== 'name' && column !== 'email')
    }
    setPage(1)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='font-bold text-2xl tracking-tight'>用户管理</h1>
          <p className='text-muted-foreground'>管理平台注册用户，支持封禁与解除封禁</p>
        </div>
        <Button variant='outline' onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <UserStatsCards />

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative flex-1 sm:max-w-sm'>
          <SearchIcon className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder='搜索姓名、邮箱或手机号'
            className='pl-9'
          />
        </div>

        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value as 'all' | 'user' | 'admin')
            setPage(1)
          }}
        >
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部角色</SelectItem>
            <SelectItem value='user'>普通用户</SelectItem>
            <SelectItem value='admin'>管理员</SelectItem>
            <SelectItem value='super_admin'>超级管理员</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={banned}
          onValueChange={(value) => {
            setBanned(value as 'all' | 'banned' | 'active')
            setPage(1)
          }}
        >
          <SelectTrigger size='sm' className='w-32 cursor-pointer'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部状态</SelectItem>
            <SelectItem value='active'>正常</SelectItem>
            <SelectItem value='banned'>已封禁</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <UsersTable
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={isLoading}
        sort={sort}
        sortDesc={sortDesc}
        onSortChange={handleSortChange}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
        onBan={(user) =>
          setBanTarget({
            id: user.id,
            name: user.name || '未命名',
            email: user.email ?? '未设置邮箱',
            banned: user.banned,
          })
        }
      />

      <BanUserDialog
        target={banTarget}
        open={banTarget !== null}
        onOpenChange={(open) => {
          if (!open) setBanTarget(null)
        }}
        onSuccess={() => {
          refetch()
        }}
      />
    </div>
  )
}
