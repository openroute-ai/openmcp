// Imported rather than taken from the ambient global: this file is ESM and the
// lint config does not declare `process` for `*.mjs`, which would leave a
// `no-undef` on the one line that reads an environment variable.
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import createNextIntlPlugin from "next-intl/plugin"
import { createMDX } from "fumadocs-mdx/next"

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)

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
 *
 * `@workspace/shared-next` is the same story at a smaller scale: it publishes
 * raw `.ts`/`.tsx` through its `exports` map, so the bundler has to compile it
 * rather than treat it as an already-built dependency.
 *
 * `@workspace/security-scan` is raw TypeScript through its `exports` map too,
 * and the scan route and the task both import it. It is the one new addition:
 * console now executes skills security scanning (`src/lib/skill-scan`).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@workspace/ui",
    "@workspace/shared-next",
    "@workspace/security-scan",
  ],
  // The framework name in every response is free reconnaissance.
  poweredByHeader: false,
  // Emits `.next/standalone`, which is what the container image runs. Without it
  // the Docker build ships the whole `.next` tree plus dev-only assets.
  output: "standalone",
  // In the pnpm workspace the traced runtime files (root node_modules store,
  // shared packages) live outside this app dir, so the tracing root has to be
  // the monorepo root. Without it the standalone bundle omits those files and
  // crashes on boot in the container.
  outputFileTracingRoot: monorepoRoot,
  /**
   * Response headers applied to every route.
   *
   * Deliberately not a `Content-Security-Policy`: the app ships inline
   * scripts, `next/font`, third-party images from GitHub and the OSS bucket,
   * and a policy loose enough not to break them would not be worth sending.
   * These five are the ones that cost nothing to set and cannot break a page.
   *
   * HSTS is opt-in through `ENABLE_HSTS` rather than unconditional because a
   * header promising https is worse than no header while the deployment is
   * still plain http on the VPC. It is read when this config loads, so the
   * value is fixed at build time.
   */
  async headers() {
    const hsts = process.env.ENABLE_HSTS
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...hsts,
        ],
      },
    ]
  },
}

// MDX outermost, same order as `apps/web`: `withMDX` merges loaders into the
// config object it is handed, so anything that rebuilds that object (next-intl
// does) would otherwise drop the MDX loaders.
export default withMDX(withNextIntl(nextConfig))