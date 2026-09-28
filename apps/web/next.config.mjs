import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

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
};

export default withNextIntl(nextConfig);
