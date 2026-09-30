import { SessionDetailPage } from '../components/session-detail-page'

export default async function SessionDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SessionDetailPage sessionId={id} />
}
