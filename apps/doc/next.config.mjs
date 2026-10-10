import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {import('next').NextConfig} */
const config = {
  // Emit `.next/standalone` so the container image ships a self-contained
  // server instead of the full build tree plus a full node_modules.
  output: "standalone",
  // In the pnpm workspace the traced runtime files (root node_modules store,
  // shared packages) live outside this app dir, so the tracing root has to be
  // the monorepo root. Without it the standalone bundle omits those files and
  // crashes on boot in the container.
  outputFileTracingRoot: monorepoRoot,
  // web's standalone embeds its whole app dir (public/ included) as a side
  // effect of its runtime fs reads being traced; doc's content is fully
  // compiled at build time, so the tracer finds no runtime fs dependency and
  // emits a minimal standalone WITHOUT public/ — the container then 404s on
  // /logo.svg and every other static asset. List public/ explicitly so the
  // standalone output is self-contained and the image needs no second copy.
  outputFileTracingIncludes: {
    "/*": ["./public/**/*"],
  },
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
