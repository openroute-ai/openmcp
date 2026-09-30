/**
 * Next.js startup hook.
 *
 * Runs once per server process before the app serves traffic. Used here to boot
 * the in-process gateway settlement job: OpenMCP does not necessarily run
 * anywhere with `vercel.json` crons, so the balance write-back path has to be
 * started by the process itself — otherwise spend never comes back off the
 * ledger until someone hits `/api/cron/provider-usage` by hand.
 *
 * Imported dynamically and gated on the Node runtime: the edge runtime has no
 * timers or DB driver, so starting a job there would throw.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { startLocalCronJobs } = await import('@/lib/cron/local-cron')
  startLocalCronJobs()
}
