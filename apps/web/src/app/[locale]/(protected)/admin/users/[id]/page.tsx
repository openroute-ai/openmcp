import { UserDetailPage } from '../components/user-detail-page'

export default async function UserDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <UserDetailPage userId={id} />
}
