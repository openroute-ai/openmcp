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
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  // Emits `.next/standalone`, which is what the container image runs. Without it
  // the Docker build ships the whole `.next` tree plus dev-only assets.
  output: "standalone",
  // ali-oss pulls in urllib, which lazily requires the optional `proxy-agent`
  // package. Bundling it makes the build fail on that missing optional dep, so
  // the Node-only storage SDK is kept as a runtime require instead.
  // `shiki`/`twoslash` are the Fumadocs code-highlighter stack: they load
  // grammars and WASM at runtime, so bundling them inflates every route that
  // renders MDX and can break their dynamic `require`s.
  serverExternalPackages: [
    "ali-oss",
    "shiki",
    "twoslash",
    "twoslash-protocol",
    "ts-morph",
    "typescript",
    "oxc-transform",
  ],
  images: {
    remotePatterns: [
      // GitHub-hosted avatars, used by the sign-in flow and by author cards
      // for repositories whose owner signed in with GitHub.
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "raw.githubusercontent.com" },
      // Blog and registry cover images uploaded through the admin console.
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "gravatar.com" },
      // Self-hosted object storage used by the OSS upload path.
      { protocol: "https", hostname: "*.aliyuncs.com" },
      { protocol: "https", hostname: "*.oss-cn-hangzhou.aliyuncs.com" },
    ],
  },
};

export default withMDX(withNextIntl(nextConfig));
