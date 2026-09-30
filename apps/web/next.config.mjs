import createNextIntlPlugin from "next-intl/plugin";
import { createMDX } from "fumadocs-mdx/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@workspace/ui",
    "@workspace/auth",
    "@workspace/db",
    "@workspace/litellm",
    "@workspace/storage",
    "@workspace/mail",
    "@workspace/payment",
  ],
  experimental: {
    proxyTimeout: 30_000,
  },
  // ali-oss pulls in urllib, which lazily requires the optional `proxy-agent`
  // package. Bundling it makes the build fail on that missing optional dep, so
  // the Node-only storage SDK is kept as a runtime require instead.
  serverExternalPackages: ["ali-oss"],
};

export default withMDX(withNextIntl(nextConfig));
