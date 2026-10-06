import { ConsoleLayout } from "@/components/console/console-layout"
import { ConsoleDecisionsContent } from "@/components/console/console-decisions-content"
import { dashboardMetadata } from "@/components/dashboard-metadata"

export const dynamic = "force-dynamic"

export const generateMetadata = () => dashboardMetadata("Decisions.title")

/**
 * The decision workbench's list, inside the user console.
 *
 * Behind the console's own gate, so `app/[locale]/console/layout.tsx` has already
 * redirected an anonymous visitor to the sign-in page and an admin to the
 * operator console. What actually authorises each read and write is `decisions.*`
 * being `protectedProcedure` with the ownership filter written into the query —
 * the gate here is UX, the same split every other console page makes.
 *
 * This page reads and creates nothing else: a board's candidates, its frozen
 * vitals and its outcome all live on `/console/decisions/[id]`. The list exists to
 * answer one question — which board do I open — and a list that also tried to be
 * the board would answer neither well.
 *
 * Translated, unlike the public radar pages. This is working text inside an
 * account rather than a shared link, and the person writing "为什么选它" is writing
 * it in their own language.
 */
export default function DecisionsPage() {
  return (
    <ConsoleLayout titleKey="Decisions.title">
      <ConsoleDecisionsContent />
    </ConsoleLayout>
  )
}
