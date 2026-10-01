/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: [
    "@takumi-rs/image-response",
    "@takumi-rs/core",
    "takumi-js",
    "@fumadocs/local-md",
    "@mdx-js/mdx",
  ],
  reactStrictMode: true,
};

export default config;
