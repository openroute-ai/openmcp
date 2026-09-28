# console

A standalone shadcn dashboard app.

- Consumes the shared UI library (`@workspace/ui`) for every component, so this
  app adds no component code to the shared package.
- Uses its **own database** (`CONSOLE_DATABASE_URL`), separate from the shared
  `DATABASE_URL` used by `apps/web` and `apps/api`.
- Authentication via `better-auth` (`@workspace/auth`), and all data access goes
  through **tRPC v11** (`/api/trpc`).
- The dashboard is the shadcn `dashboard-01` block, rewired to read live data
  from this app's database.

## Routes

| Route         | Description                                       |
| ------------- | ------------------------------------------------- |
| `/dashboard`  | `dashboard-01` block, requires a session          |
| `/sign-in`    | Email + password sign in                          |
| `/sign-up`    | Create an account (also creates the auth session) |
| `/api/auth/*` | better-auth handler                               |
| `/api/trpc/*` | tRPC fetch handler (batched, superjson)           |

## Authentication

Email + password sign-in and sign-up run through Better Auth
(`@workspace/auth`), the same package `apps/web` and `apps/api` use. Sessions
are created by Better Auth and served by the route handlers under `/api/auth`.

`proxy.ts` redirects unauthenticated visitors to `/sign-in`; the tRPC routers
additionally guard every procedure with `protectedProcedure`, so an
unauthenticated call returns HTTP 401 even if it bypasses the proxy.

### Redis rate limiting

When `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) is set, the
auth instance enables Better Auth's rate limiter backed by Redis
(`createRedisRateLimitStorage` from `@workspace/auth`, keys
`openmcp:console:auth:rate-limit:*`):

- `/sign-in*` and `/sign-up*` are capped at **3 requests / 10 s per IP**
  (Better Auth's stricter built-in rules); password-reset and verification
  paths at 3 / 60 s.
- All other auth calls share a default bucket of **100 / 60 s per IP**.
- Counters live in Redis, so the limits hold across replicas and restart;
  the increment is an atomic Lua script.
- If Redis is unreachable the limiter fails open (logins unaffected) and logs
  a single warning.

Without Redis env vars this app behaves exactly as before (no rate limiting),
so local development that skips Redis is safe by default.

## Data model

`db/schema.ts` defines two tables plus the four better-auth tables. The auth
tables are re-used from `@workspace/db/schema` so there is a single source of
truth, but they are created in **this app's own database**.

- `sections` — rows behind the dashboard data table. Dragging a row calls
  `sections.reorder`, which persists the new ordering.
- `traffic` — daily desktop/mobile counts behind the area chart. The chart's
  range tabs (`7d`/`30d`/`90d`/`12m`) filter server-side via
  `traffic.series`.

tRPC routers live in `lib/trpc/routers`:

- `stats.overview` — aggregates for the four summary cards
- `sections.list`, `sections.reorder`, `sections.countsByStatus`
- `traffic.series`

## Environment

Copy `apps/console/.env.example` (or set these in your shell):

| Variable                      | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `CONSOLE_DATABASE_URL`        | This app's own Postgres database                     |
| `CONSOLE_BETTER_AUTH_URL`     | Public base URL, defaults to `http://localhost:3001` |
| `BETTER_AUTH_SECRET`          | Shared with the other apps                           |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated list of allowed origins              |
| `REDIS_URL`                   | Redis URL for the auth rate limiter                  |

The app expects to run on port **3001** so it does not collide with `apps/web`.

## Setup

```bash
# create the database (once)
psql -c 'create database console'

pnpm --filter console db:migrate
pnpm --filter console db:seed
pnpm --filter console dev
```

`db:seed` is idempotent — it only inserts when the tables are empty, and fills
60 sections and 365 days of traffic so the dashboard has something to show.
