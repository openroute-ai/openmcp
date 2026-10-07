/**
 * Server bootstrap hooks.
 *
 * Next starts this file on both runtimes (Node and Edge) and on every worker,
 * so the gate is threefold: node only, production only, explicitly enabled.
 * The production/enabled checks live in `@/lib/tasks/in-process-cron` so the
 * two halves of the cron story (decide + run) stay in one module; the node
 * check lives here, and it has to *wrap* the import rather than follow it.
 *
 * Why: Next compiles an Edge variant of this file even though the only Edge
 * consumer in this app is `src/proxy.ts`, and Turbopack traces dynamic
 * imports when building that variant's module graph. The cron stack behind
 * the import is Node-only (`fs`, `child_process`, `path`), so the Edge
 * compilation reported `node:*`-in-Edge errors for `skill-scan/local.ts` and
 * `skill-scan/index.ts`. `process.env.NEXT_RUNTIME` is inlined per variant —
 * `"edge"` here — which leaves this branch constant-false for the Edge build
 * and the import compiled out of its graph entirely. An early `return` before
 * the import would not do that: bundlers do not treat code after a return as
 * unreachable, so the graph would be built either way.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { isInProcessCronEnabled, startInProcessCron } = await import(
      "@/lib/tasks/in-process-cron"
    )

    if (isInProcessCronEnabled()) startInProcessCron()
  }
}
