import { notFound } from 'next/navigation'
import { StatementDetail } from '@/components/dashboard/statement-detail'

interface StatementDetailRouteProps {
  params: Promise<{
    id: string
  }>
}

/**
 * 月度收益账单详情路由。
 *
 * 只做参数透传：页面本身是客户端组件（要 tRPC 查询 + 确认 mutation），
 * 归属校验在服务端 `getMyStatement` 的 WHERE 里完成，这里的 `notFound`
 * 只兜住 `id` 为空这种不可能从列表页构造出来的 URL。
 */
export default async function StatementDetailRoute({ params }: StatementDetailRouteProps) {
  const { id } = await params

  if (!id) notFound()

  return <StatementDetail id={id} />
}
