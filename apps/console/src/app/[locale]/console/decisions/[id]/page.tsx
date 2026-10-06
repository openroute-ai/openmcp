import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleDecisionDetail } from "@/components/console/console-decision-detail-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

// The tab names the section the page belongs to. The board's own title is not
// known here: the page is a shell and the data is fetched by the client, so
// putting it in the metadata would mean fetching it twice, on a path that runs
// before the page itself.
export const generateMetadata = () => dashboardMetadata("Decisions.detail")

/**
 * One decision board: its candidates, the vitals each of them had when it was
 * added, and the outcome.
 *
 * A detail route rather than a dialog, because this is where the work happens —
 * five candidates, a note each, an outcome. A board with two candidates is
 * readable as a row; one with five is not, and the person deciding has to see
 * them side by side.
 *
 * Same gate as the list, and for the same reason: the ownership filter lives in
 * `decisions.read`, so a board belonging to another account answers exactly as a
 * missing one does.
 */
export default async function ConsoleDecisionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { id } = await params

  return (
    <ConsoleLayout titleKey="Decisions.detail">
      <ConsoleDecisionDetail boardId={id} />
    </ConsoleLayout>
  )
}
