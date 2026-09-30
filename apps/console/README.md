# console

A standalone shadcn dashboard app.

- Consumes the shared UI library (`@workspace/ui`) for every component, so this
  app adds no component code to the shared package.
- Uses its **own database** (`CONSOLE_DATABASE_URL`), separate from the shared
  `DATABASE_URL` used by `apps/web` and `apps/api`.
- Authentication via `better-auth`, configured directly in `src/lib/auth.ts`
  rather than through a shared package, and all data access goes through
  **tRPC v11** (`/api/trpc`).
- The dashboard started as the shadcn `dashboard-01` block and has been
  rewired to read live data from this app's database; the starter demo tables
  (`sections`, `traffic`) were dropped once nothing read them.

## Layout

Application code lives under `src/`: the App Router in `src/app`, the UI in
`src/components`, and the domain in `src/db`, `src/hooks`, `src/lib` and
`src/proxy.ts`. Tests sit in `src/test`. Only build and tool configuration
stays at the app root, and `@/` resolves to `src/`.

## Routes

| Route                     | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `/dashboard`              | Overview: counts, task status, recent runs (admin)    |
| `/console`                | Repository list for a signed-in non-admin             |
| `/dashboard/rankings`     | Week / month / rising-stars rankings                  |
| `/dashboard/tasks`        | Task schedule, enable/disable, run on demand          |
| `/dashboard/projects`     | Projects with repository stats, skills, last sync     |
| `/dashboard/skills`       | Synced skills and their push state                    |
| `/dashboard/sync`         | Project and readme sync jobs, newest first            |
| `/sign-in`, `/sign-up`    | Email + password auth                                 |
| `/api/auth/*`             | better-auth handler                                   |
| `/api/trpc/*`             | tRPC fetch handler (batched, superjson)               |
| `/api/rankings/*.json`    | Public ranking JSON (`week`, `month`, `rising-stars`) |
| `/api/cron/github`        | The single scheduler entrypoint (Vercel Cron)         |
| `/api/webhook/[task]`     | Inbound trigger for a named task                      |
| `/api/internal/repos`     | Machine-to-machine repository ingest                  |
| `/api/skills-sync/export` | Cursor-paged skill export                             |

### Token-guarded routes

`/api/cron/github`, `/api/webhook/[task]`, `/api/internal/repos` and
`/api/skills-sync/export` all authenticate the same way — a `Bearer` header
compared in constant time — and all **fail closed**: with no secret
configured the route returns 404 rather than 401, so an unconfigured instance
does not confirm that the route exists.

| Route                     | Env var                | Notes                        |
| ------------------------- | ---------------------- | ---------------------------- |
| `/api/cron/github`        | `CRON_SECRET`          | Vercel Cron sends it         |
| `/api/webhook/[task]`     | `CRON_SECRET`          | Same secret, inbound trigger |
| `/api/internal/repos`     | `CONSOLE_API_TOKEN`    | `POST` a `RepoInfo`          |
| `/api/skills-sync/export` | `SKILLS_WEBHOOK_TOKEN` | `?cursor=&limit=` paging     |

## Authentication

Email + password sign-in and sign-up run through Better Auth, configured
directly in `src/lib/auth.ts`. Sessions are created by Better Auth and served
by the route handlers under `/api/auth`.

Console does **not** use `@workspace/auth` (which `apps/web` and `apps/api`
share). It has its own database and its own `user` table, so there was no
shared identity left to abstract; going through the shared package only meant
its `phoneNumber()` plugin and console's own registered the same five endpoints
twice, which Better Auth reports as an endpoint path conflict. Owning the
configuration keeps one entry in the plugin list.

`proxy.ts` redirects unauthenticated visitors to `/sign-in`; the tRPC routers
additionally guard every procedure with `protectedProcedure`, so an
unauthenticated call returns HTTP 401 even if it bypasses the proxy.

### Redis rate limiting

When `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) is set, the
auth instance enables Better Auth's rate limiter backed by Redis
(`createRedisRateLimitStorage` from `src/lib/rate-limit.ts`, keys
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

`src/db/schema.ts` re-uses the Better Auth tables from `@workspace/db/schema` so
there is a single source of truth, but they are created in **this app's own
database**. On top of those it defines the migrated GitHub-sync domain in
`src/db/schema/github.ts`:

- `repos` — repository statistics, plus the README, its translation, the icon
  and the OSS image URLs written by their own tasks. A repository is
  **collected** by being stored here, and **curated** once a project points at
  it: only curated repositories are deep-refreshed, star-swept and turned into
  authors by the scheduled tasks, so an uncurated entry keeps its metadata
  current without becoming a project.
- `projects`, `project_skills` — a repository's projects and the parsed
  `SKILL.md` documents, with `synced_to_web_at` / `last_sync_error` recording
  the downstream push outcome.
- `project_sync_jobs`, `readme_sync_jobs` — sync history, shown on `/dashboard/sync`.
- `task_definitions`, `task_status`, `task_executions` — the schedule, the
  locks and the history. `task_executions` is what survives a run, so "what
  happened last time" outlives "is anything running now".
- `snapshots`, `repo_weekly_stars`, `rising_star_*` — the ranking inputs.

Task definitions are **seeded from code**, not from a migration
(`src/lib/tasks/seed.ts`), so adding a task is a code change. Seeding is
insert-only, so an operator's schedule or enable flag is never reverted.

tRPC routers live in `src/lib/trpc/routers`:

- `overview.snapshot` — counts and the most recent executions
- `tasks.list`, `tasks.executions`, `tasks.setEnabled`, `tasks.runNow`
- `projects.list`, `skills.list`
- `sync.list` — project and readme jobs merged, newest first
- `rankings.weekly`, `rankings.monthly`, `rankings.risingStars`

## Environment

Copy `apps/console/.env.example` (or set these in your shell):

| Variable                      | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `CONSOLE_DATABASE_URL`        | This app's own Postgres database                     |
| `CONSOLE_BETTER_AUTH_URL`     | Public base URL, defaults to `http://localhost:3001` |
| `BETTER_AUTH_SECRET`          | Shared with the other apps                           |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated list of allowed origins              |
| `REDIS_URL`                   | Redis URL for the auth rate limiter                  |
| `GITHUB_ACCESS_TOKEN`         | Required by every GitHub call and the sync tasks     |
| `CRON_SECRET`                 | Bearer for the scheduler and inbound webhook         |
| `CONSOLE_API_TOKEN`           | Bearer for the repository ingest endpoint            |
| `SKILLS_WEBHOOK_URL`          | Outbound webhook for synced skills                   |
| `SKILLS_WEBHOOK_TOKEN`        | Outbound bearer, and the export endpoint's bearer    |

`.env.example` documents the rest (translation providers, Aliyun OSS, WeCom,
build hooks). Most are optional; the tasks that need one are skipped or fail
loudly rather than degrading silently.

The app expects to run on port **3001** so it does not collide with `apps/web`.

## Setup

```bash
# create the database (once)
psql -c 'create database console'

pnpm --filter console db:migrate
pnpm --filter console db:seed   # optional: task definitions before first deploy
pnpm --filter console dev
```


### Accounts and roles

The console serves two audiences from one deployment: an operator curates the
catalogue from `/dashboard`, and anyone else signed in uses `/console`, which is
the repository list and nothing else. The role is stored on `user.role` (shared
schema). The column defaults to `user`, so new accounts land on `/console`.

- An `admin` sees `/dashboard`; every other signed-in account sees `/console`.
- Layout gates are UX (`/dashboard` redirects non-admins to `/console`, and
  `/console` redirects admins to `/dashboard`), and the real authorization is on
  each tRPC procedure: `adminProcedure` refuses anyone whose `role !== "admin"`,
  and the routers reflect the split (`repos.list` and `repos.create` are
  `protectedProcedure` for non-admins, while everything else is admin-only).

To bootstrap the first operator:

```bash
pnpm --filter console db:role -- <email>  # promote to admin
pnpm --filter console db:role -- <email> --list  # check current role
pnpm --filter console db:role -- <email> user  # demote back
```


### Drizzle commands

`drizzle.config.ts` sits at the app root and loads `.env` then `../../.env`, so
bare `npx drizzle-kit` commands work from `apps/console`:

```bash
npx drizzle-kit generate   # writes src/db/drizzle; needs no database
npx drizzle-kit migrate    # applies src/db/drizzle
npx drizzle-kit push       # dev only: diff the schema straight onto the database
npx drizzle-kit studio
```

`generate` only reads the schema, so it runs without `CONSOLE_DATABASE_URL`;
the commands that connect require it and fail with
`Please provide required params for Postgres driver: url: ''` when it is
missing.

> `push` diffs the **whole** schema, so pointing it at a database that still
> holds tables from another app will offer to drop them. Use `migrate` there.

`db:seed` is idempotent — `seedDefinitions` only inserts definitions that are
missing, so it is safe to re-run and never reverts an edited schedule.
