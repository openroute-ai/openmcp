import createNextIntlPlugin from "next-intl/plugin"
import { createMDX } from "fumadocs-mdx/next"

/**
 * The intl plugin bundles the request config into the server build.
 *
 * The path has to be relative to this file: Turbopack cannot resolve an
 * absolute path here, so `fileURLToPath(new URL(...))` fails the build with
 * "Turbopack support for next-intl currently does not support absolute paths".
 *
 * https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing#next-config
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts")

/**
 * Compiles `content/docs` at build time. MDX is ESM-only, which is why this
 * file is `next.config.mjs` rather than a TypeScript config.
 *
 * It also owns the `mdx`/`md` page extensions and the loaders for the content
 * tree, so `content/docs` is compiled by the same pipeline as the app.
 */
const withMDX = createMDX()

/**
 * `@workspace/db` was here and is not any more. Console has its own database
 * and declares its own tables (`src/db/schema.ts`), so the only workspace
 * source in its build is the shared UI. Transpiling `@workspace/db` shipped
 * web's entire schema — 86 tables across blog/mcp/registry/catalog/workflow/
 * personas/payment/oauth — into console's build output, none of which exists
 * in `CONSOLE_DATABASE_URL`. `@workspace/ui` stays: shared components are the
 * deliberate L1 layer (docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md §5.9.1).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui"],
}

// MDX outermost, same order as `apps/web`: `withMDX` merges loaders into the
// config object it is handed, so anything that rebuilds that object (next-intl
// does) would otherwise drop the MDX loaders.
export default withMDX(withNextIntl(nextConfig))