import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { SessionDetail } from "@/components/sessions/session-detail-content"

export const dynamic = "force-dynamic"

// The tab names the section the page belongs to. The session itself is not
// named here: the page is a shell and the data is fetched by the client, so
// putting it in the metadata would mean fetching it twice, on a path that runs
// before the page itself.
export async function generateMetadata() {
  return dashboardMetadata("Sessions.title")
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params

  return (
    <DashboardLayout titleKey="Sessions.title">
      <SessionDetail id={id} />
    </DashboardLayout>
  )
}