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

| App | URL |
| --- | --- |
| API | `http://localhost:8080` --> `/docs` for Scala UI |
| Dashboard | `http://localhost:3000` |
| Docs | `http://localhost:6969` |

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

## Adding UI components

```bash
pnpm --filter @workspace/ui dlx shadcn@latest add button
```

Then import in any app:

```tsx
import { Button } from "@workspace/ui/components/button"
```
