#
# apps/console — self-contained Next.js image.
#
# Build (context is the monorepo root so the shared lockfile and packages/ are
# available to the install + turbo build):
#
#   docker build -f apps/console/Dockerfile -t openmcp-console .
#
# Run:
#
#   docker run --rm -p 20002:20002 \
#     -e BETTER_AUTH_SECRET=... -e CONSOLE_DATABASE_URL=postgres://... \
#     openmcp-console
#
# `next build` with `output: "standalone"` traces only the files the server
# actually requires, so the runtime image never ships a full node_modules or the
# dev-only halves of `.next`. See apps/console/next.config.mjs.

# ---------------------------------------------------------------------------
# base: pinned toolchain shared by every later stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install the workspace from the lockfile only.
#
# Every workspace manifest is copied up-front so this layer is keyed purely on
# the lockfile + manifests. Editing app source later does not re-run the
# install, which keeps rebuilds fast.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json          apps/api/package.json
COPY apps/console/package.json      apps/console/package.json
COPY apps/doc/package.json          apps/doc/package.json
COPY apps/web/package.json          apps/web/package.json
COPY apps/vercel-egress/package.json apps/vercel-egress/package.json
COPY packages/auth/package.json           packages/auth/package.json
COPY packages/db/package.json             packages/db/package.json
COPY packages/eslint-config/package.json  packages/eslint-config/package.json
COPY packages/litellm/package.json        packages/litellm/package.json
COPY packages/mail/package.json           packages/mail/package.json
COPY packages/payment/package.json        packages/payment/package.json
COPY packages/security-scan/package.json  packages/security-scan/package.json
COPY packages/shared-next/package.json    packages/shared-next/package.json
COPY packages/sms-captcha/package.json    packages/sms-captcha/package.json
COPY packages/storage/package.json        packages/storage/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/ui/package.json             packages/ui/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile console and the workspace packages it depends on.
#
# Build-time public configuration (NEXT_PUBLIC_* site identity, ENABLE_HSTS,
# analytics) is read from apps/console/.env.production, which `next build`
# loads automatically before it evaluates next.config.mjs. Server-only secrets
# are NOT needed to build and are supplied at run time.
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/console/node_modules ./apps/console/node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml

# Build-time config lives in apps/console/.env.production and is copied in with
# the app below. Deliberately no ARG/ENV block for these variables: @next/env
# never overrides a key the process environment already defines, so an ENV set
# from an unpassed --build-arg (empty string) would shadow the file instead of
# letting it through.
COPY apps/console ./apps/console
COPY packages ./packages
COPY tsconfig.json ./
RUN pnpm --filter console build

# ---------------------------------------------------------------------------
# runtime: only the traced standalone server + static assets.
#
# `.next/standalone` nests under `apps/console` because the tracing root is the
# monorepo root (outputFileTracingRoot). We run from inside that folder so the
# relative `.next/static` and `public` paths resolve.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=20002
WORKDIR /app

# Run as the unprivileged user Next.js's Alpine image already ships.
COPY --from=build --chown=node:node /app/apps/console/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/console/.next/static ./apps/console/.next/static
COPY --from=build --chown=node:node /app/apps/console/public ./apps/console/public

USER node
EXPOSE 20002
CMD ["node", "apps/console/server.js"]
