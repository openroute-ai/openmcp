# Studio

Turborepo monorepo with a Hono API, Next.js dashboard, Fumadocs documentation site, and shared packages.

## Structure

```
apps/
  api/          Hono REST API with Better Auth + Drizzle ORM
  dashboard/    Next.js 16 dashboard (Turbopack)
  doc/          Fumadocs documentation site with AI search

packages/
  auth/         Shared Better Auth configuration
  db/           Drizzle ORM schema and migrations
  ui/           shadcn/ui component library (55 components)
  eslint-config/    Shared ESLint 9 presets
  typescript-config/ Shared TypeScript presets
```

## Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io) 10.33+
- [Docker](https://www.docker.com) (for local Postgres)

## Getting started

```bash
# install dependencies
pnpm install

# copy and fill environment variables
cp .env.example .env

# start Postgres
docker compose up -d

# run database migrations
pnpm --filter @workspace/db db:migrate

# start all apps in dev mode
pnpm dev
```

| App       | URL                                              |
| --------- | ------------------------------------------------ |
| API       | `http://localhost:8080` --> `/docs` for Scala UI |
| Dashboard | `http://localhost:20001`                         |
| Console   | `http://localhost:20002`                         |
| Docs      | `http://localhost:6969`                          |

## Common commands

```bash
# development
pnpm dev              # start all apps
pnpm build            # build everything
pnpm lint             # lint all packages
pnpm typecheck        # type-check all packages
pnpm format           # format all packages

# database
pnpm --filter @workspace/db db:generate   # generate migration
pnpm --filter @workspace/db db:migrate    # apply migrations
pnpm --filter @workspace/db db:studio     # open Drizzle Studio

# auth schema
pnpm --filter @workspace/auth auth:generate  # regenerate auth schema

# ui components
pnpm --filter @workspace/ui dlx shadcn@latest add <component>
```

## Docker images

Two images are defined. Both use multi-stage builds on `node:22-alpine` and
Next.js `output: "standalone"` so the runtime stage ships only the traced
server bundle (no full `node_modules`, no dev-only `.next`).

### `apps/console` — standalone

```bash
docker build --provenance=false --sbom=false -f apps/console/Dockerfile -t openmcp-console .

docker run --rm -p 20002:20002 \
  -e BETTER_AUTH_SECRET=... \
  -e CONSOLE_DATABASE_URL=postgres://... \
  openmcp-console
```

> **Pushing to Aliyun ACR 个人版 (or any registry without OCI 1.1 artifact
> support):** keep `--provenance=false --sbom=false` on the build. BuildKit
> ≥ v0.32 (bundled with Docker Engine ≥ 29.7 / buildx ≥ 0.36) stores
> provenance/SBOM attestations as OCI artifacts by default, and a personal ACR
> rejects the image index with
> `unknown manifest class for application/vnd.oci.empty.v1+json`. The flags must
> be present **at build time** — re-pushing an already-built index will not fix
> it, you have to rebuild.
>
> ```bash
> REGISTRY=crpi-l9d06aaeh8b6jjur.cn-hangzhou.personal.cr.aliyuncs.com
> REPO=$REGISTRY/autoroute/openmcp-vercelai
> docker build --provenance=false --sbom=false \
>   -f apps/console/Dockerfile -t "$REPO:v20261010" .
> docker push "$REPO:v20261010"
> ```
>
> To keep attestations (签名/SBOM/SLSA) you need an ACR 企业版 instance or
> another registry with OCI 1.1 support; personal edition cannot store them.

Build-time public config (site identity, `ENABLE_HSTS`, optional analytics) is
read from `apps/console/.env.production` — that file is the place to rename the
brand or switch on HSTS, and either change needs a rebuild. It holds public
values only; runtime secrets stay out of it and are passed with `-e` as shown
above.

### `web` + `doc` + `api` — one image, s6-supervised

`docker/Dockerfile.web-doc-api` builds all three into a single image managed by
[s6-overlay](https://github.com/just-containers/s6-overlay). Each app runs as its
own service on its own port and loads its **own** env file (the three apps'
variables are never in one file):

| Service | App                   | Port | Env file (mount to override) |
| ------- | --------------------- | ---- | ---------------------------- |
| `web`   | Next.js standalone    | 3000 | `/etc/s6/web.env`            |
| `doc`   | Next.js standalone    | 3001 | `/etc/s6/doc.env`            |
| `api`   | Hono (self-contained) | 8080 | `/etc/s6/api.env`            |

Build (context is the repo root; `NEXT_PUBLIC_*` are inlined at build time —
pass them as `--build-arg`):

```bash
docker build --provenance=false --sbom=false \
  -f docker/Dockerfile.web-doc-api -t openmcp-stack \
  --build-arg NEXT_PUBLIC_BASE_URL=https://www.example.com .
```

Run (mount real config over the baked placeholder env files):

```bash
docker run --rm \
  -p 3000:3000 -p 3001:3001 -p 8080:8080 \
  -v $PWD/web.env:/etc/s6/web.env:ro \
  -v $PWD/doc.env:/etc/s6/doc.env:ro \
  -v $PWD/api.env:/etc/s6/api.env:ro \
  openmcp-stack
```

Example env templates live in `docker/env/{web,doc,api}.env`. See each app's
`.env.example` for the full list of settings. The `api` process keeps `sharp`
external (a native module) and loads it from `/app/api/node_modules`; every
other dependency is bundled into the api by `tsdown`
(`apps/api/tsdown.config.ts`) to keep the image small.

## Adding UI components

```bash
pnpm --filter @workspace/ui dlx shadcn@latest add button
```

Then import in any app:

```tsx
import { Button } from "@workspace/ui/components/button"
```
