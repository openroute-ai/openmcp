import { dashboardMetadata } from "@/components/dashboard-metadata"
import { DashboardLayout } from "@/components/dashboard-layout"
import { AuthorDetail } from "@/components/authors/author-detail-content"

export const dynamic = "force-dynamic"

// The tab names the section the page belongs to. The author's name is not known
// here: the page is a shell and the data is fetched by the client, so putting it
// in the metadata would mean fetching it twice, on a path that runs before the
// page itself.
export async function generateMetadata() {
  return dashboardMetadata("Authors.title")
}

export default async function AuthorDetailPage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>
}) {
  // The handle, not an id: `authors.byId` reads by `username`, and it is the
  // handle that appears in a project's byline — so a link from there lands here
  // without a lookup.
  const { username } = await params

  return (
    <DashboardLayout titleKey="Authors.title">
      <AuthorDetail username={username} />
    </DashboardLayout>
  )
}