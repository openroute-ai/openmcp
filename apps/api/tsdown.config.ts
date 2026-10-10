import { defineConfig } from "tsdown"

export default defineConfig({
  entry: "src/index.ts",
  outDir: "dist",
  clean: true,
  // Bundle every runtime dependency into `dist/index.mjs` so the deployable is
  // self-contained. `pnpm deploy --prod` would drag the whole declared closure
  // (the full @workspace/ui tree plus every optional better-auth adapter) into
  // the image — ~780MB — even though the server only imports a sliver of it.
  // Tree-shaking here keeps the bundle to a few MB.
  //
  // `sharp` is the one exception: it loads a native `.node` binary that cannot
  // be inlined into a JS bundle, so it stays external and is provided in the
  // runtime image (see docker/Dockerfile.web-doc-api). It is a real runtime
  // dependency — pulled in transitively via @workspace/auth →
  // @workspace/sms-captcha/server → puzzle-generator.
  noExternal: [/.*/],
  external: ["sharp"],
  // Some transitive CJS deps (e.g. better-auth's optional Next.js integration,
  // which lands in the bundle even though this server never calls it) reference
  // `__dirname`/`require`. ESM output has no such globals, so tsdown injects
  // shims; without them the bundle throws `__dirname is not defined` on boot.
  shims: true,
})
