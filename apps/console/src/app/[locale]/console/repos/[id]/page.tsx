import { dashboardMetadata } from "@/components/dashboard-metadata"
import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleRepoDetail } from "@/components/console/console-repo-detail-content"

export const dynamic = "force-dynamic"

// The tab names the section the page belongs to. The repository's own name is
// not known here: the page is a shell and the data is fetched by the client, so
// putting it in the metadata would mean fetching it twice, on a path that runs
// before the page itself.
export async function generateMetadata() {
  return dashboardMetadata("Console.detail")
}

export default async function ConsoleRepoDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params

  return (
    <ConsoleLayout titleKey="Console.detail">
      <ConsoleRepoDetail id={id} />
    </ConsoleLayout>
  )
}
