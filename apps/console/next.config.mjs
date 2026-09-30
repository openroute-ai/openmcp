import createNextIntlPlugin from "next-intl/plugin"

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui", "@workspace/db"],
}

export default withNextIntl(nextConfig)
