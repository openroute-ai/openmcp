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

`src/db/schema.ts` declares console's **own** copy of the four Better Auth
tables — `user`, `session`, `account`, `verification` — plus the GitHub-sync
domain in `src/db/schema/github.ts`. It deliberately imports **nothing** from
`@workspace/db`.

This used to be the other way round: the file re-exported all of
`@workspace/db/schema`, which is web's entire schema (86 tables across blog,
mcp, registry, catalog, workflow, personas, payment, oauth). Console's queries
were unaffected, but `drizzle-kit generate` was not — diffing against
`meta/0006_snapshot.json` produced a migration that would have `CREATE TABLE`d
every one of those web tables inside `CONSOLE_DATABASE_URL`, and re-added
columns an earlier migration had already added. The same import also handed all
86 tables to Better Auth as its `schema`, of which it reads four.

Two details are load-bearing and easy to undo by accident:

- `session` deliberately omits `active_organization_id` / `impersonated_by`.
  Those belong to Better Auth's organization plugin, which console does not
  install (`src/lib/auth.ts` registers only `phoneNumber` and `openAPI`), so
  importing the shared definition made every `generate` try to add two columns
  nothing ever reads. If the organization plugin is ever enabled, add them here
  in the same change.
- The four tables must stay column-for-column identical to
  `packages/db/src/auth-schema.ts`. That alignment used to be automatic through
  the import; now it is a manual obligation, and the console-side definitions
  carry the reasoning.

The tables are created in **this app's own database** either way. On top of the
auth tables it defines the migrated GitHub-sync domain in
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

| Variable                      | Purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `CONSOLE_DATABASE_URL`        | This app's own Postgres database                      |
| `CONSOLE_DATABASE_SSL`        | Overrides the host-based SSL guess                    |
| `PORT`                        | The port `next start` binds                           |
| `BETTER_AUTH_URL`             | Public base URL, defaults to `http://localhost:20002` |
| `BETTER_AUTH_SECRET`          | Shared with the other apps                            |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Comma-separated list of allowed origins               |
| `REDIS_URL`                   | Redis URL for the auth rate limiter                   |
| `GITHUB_ACCESS_TOKEN`         | Required by every GitHub call and the sync tasks      |
| `CRON_SECRET`                 | Bearer for the scheduler and inbound webhook          |
| `CONSOLE_API_TOKEN`           | Bearer for the repository ingest endpoint             |
| `SKILLS_WEBHOOK_URL`          | Outbound webhook for synced skills                    |
| `SKILLS_WEBHOOK_TOKEN`        | Outbound bearer, and the export endpoint's bearer     |

`.env.example` documents the rest (translation providers, Aliyun OSS, WeCom,
build hooks). Most are optional; the tasks that need one are skipped or fail
loudly rather than degrading silently.

The app runs on port **20002** (`dev` passes `--port 20002`, `start` binds
`PORT`) so it does not collide with `apps/web` on 20001. `BETTER_AUTH_URL`, `PORT`
and
`BETTER_AUTH_TRUSTED_ORIGINS` have to name that same port: Better Auth rejects
any sign-in whose `Origin` is neither its base URL nor a trusted origin
(`403 {"code":"INVALID_ORIGIN"}`), and the server-side tRPC client dials
`http://localhost:$PORT`.

### Why a stale cookie used to loop

The proxy can only see that a session _cookie_ is present, never that the
session behind it is valid. It used to bounce such a visitor off `/sign-in` and
`/sign-up` on that basis, which looped forever with an expired cookie: the auth
page redirected to the root, the root resolved the session, found nobody and
redirected straight back. The proxy no longer redirects signed-in visitors at
all; the auth pages call `requireUnauth` (`src/lib/auth/session.ts`), which
validates the session server-side and lands the account on the console its role
belongs to — the same reasoning, and the same shape, as `apps/web`'s proxy.

## Setup

console uses its **own database**, separate from the `DATABASE_URL` that
`apps/web` and `apps/api` share. It has to: fifteen of its table names
(`projects`, `packages`, `repos`, `tags`, `task_*`, …) collide with the shared
schema, but the columns differ — the shared tables are camelCase
(`projects.repoId`, `packages.devDependencies`) and console's are snake_case
(`projects.repo_id`). One database cannot hold both, and a shared *schema* would
not help either: the migrations reference `"public"."user"` explicitly, so a
console schema would have its foreign keys land on web/api's tables.

```bash
# create the database (once)
psql -c 'create database console'

pnpm --filter console db:migrate
pnpm --filter console db:seed   # optional: task definitions before first deploy
pnpm --filter console dev
```

`db:migrate` applies the single baseline in `src/db/drizzle`; see
[Drizzle commands](#drizzle-commands) for the schema entry point, why the
migrations were squashed, and how to verify a fresh database.

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

`drizzle.config.ts` sits at the app root and loads `.env.local` then
`../../.env`, so bare `npx drizzle-kit` commands work from `apps/console`:

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

#### The schema entry point is `src/db/drizzle-schema.ts`

`drizzle.config.ts` points `schema` at `src/db/drizzle-schema.ts`, **not** at
`src/db/schema.ts`. That split is load-bearing.

`src/db/schema.ts` re-exports `@workspace/db/schema` wholesale, which is what
the runtime wants — `@workspace/auth` and the console's services import `user`,
`session`, `account` from there. But drizzle-kit does not read the runtime
`schema` object. It imports the entry module and walks **every export** looking
for table objects, so pointing it at `src/db/schema.ts` hands it the whole
shared schema: `blog_posts`, `workflows`, `personas`, `mcp_servers`,
`provider_earnings` and several hundred more that console neither owns nor
queries. `generate` against it emitted a migration with a thousand lines of
`CREATE TABLE` for other apps' tables; `push` would have offered to drop them.

`src/db/drizzle-schema.ts` therefore names the twenty-two tables console owns —
the four better-auth tables plus console's eighteen GitHub tables — and nothing
else.

Two consequences to keep in mind when changing the schema:

- **A new table is not picked up until it is listed there.** `generate` does not
  warn. The symptom is a table that exists in TypeScript but not in the
  database, and better-auth fails at runtime with `42703 undefined_column`
  rather than at build time.
- **`user` comes from `./schema`, not from `@workspace/db/schema`.** Both declare
  a `pgTable("user")`; console's copy is the one carrying `role`, the
  phone-number pair and better-auth's ban columns, and the runtime `schema`
  object lists it last so it wins the key. Naming the shared one would generate
  DDL for the wrong `user`, and since drizzle keys tables by name the two would
  collide.

#### Migrations are a single squashed baseline

`src/db/drizzle/` holds one file, `0000_*.sql`, produced by
`drizzle-kit generate` against a database-free schema. It creates all
twenty-two tables with their indexes and foreign keys.

The app previously carried `0000`–`0007`, built incrementally over months. That
history was not trustworthy:

- The migrations had drifted from the code. better-auth 1.7.6's `createSession()`
  writes `active_organization_id` and `impersonated_by` unconditionally, but no
  migration ever added them, because `0000` predates those columns landing in
  `packages/db/src/auth-schema.ts`. The symptom was a `42703` on the very first
  sign-up, with no way to regenerate the missing step because `generate` was
  pointed at the over-broad schema described above.
- `0007` was in the journal with no matching `meta/` snapshot.
- Nothing had ever been applied to a console database, so there was no
  environment in which the sequence was known to work end to end.

The baseline was generated and then applied to a freshly created `console`
database, and better-auth's sign-up → session → sign-out was exercised against
it. After `db:migrate`, `drizzle.__drizzle_migrations` holds exactly one row;
more than one means the ledger is carrying rows for migrations that no longer
exist, and `db:migrate` reads the ledger before deciding what to apply, so a
stale row is how a database ends up claiming a schema it does not have. A
database with no ledger at all was built with `push` rather than `migrate`, and
has nothing stale to worry about.

#### Checking the auth tables against better-auth

better-auth ships a generator that prints the Drizzle schema its own model
expects:

```bash
npx @better-auth/cli generate --config src/lib/auth.ts --output /tmp/ba.ts --yes
```

Two caveats, both of which bit this app:

- **Its output is not authoritative for the columns that matter here.** The CLI
  resolves independently of the runtime, and the version published to npm lags
  the runtime. Generated against `better-auth@1.7.6` at runtime, the CLI
  produced a `session` table **without** `active_organization_id` /
  `impersonated_by` — following it would have reproduced the `42703`. The
  runtime's own `INSERT` is the ground truth, so the tables are validated by
  running the flow, not by reading the CLI's output.
- **It needs an adapter it recognises.** With the default `memory` adapter it
  fails with `memory is not supported`. Point `--config` at the real
  `src/lib/auth.ts`, which uses `drizzleAdapter`.

#### Verifying a migration actually works

The failure mode that motivated squashing is silent: the migration applies
cleanly, and the app only breaks later on a request that touches the affected
table. After `db:migrate` on a new database, exercise the auth flow rather than
trusting the exit code:

```ts
const { headers, response } = await auth.api.signUpEmail({
  body: { email, password, name }, returnHeaders: true,
})
const req = new Headers({ cookie: headers.getSetCookie().map(c => c.split(";")[0]).join("; ") })
await auth.api.getSession({ headers: req })
```

`getSession` issuing the `SELECT` that every protected page issues is the check
that matters — it is the query that returned `relation "session" does not
exist` before.

#### Rebuilding a database through a connection pooler

`DROP DATABASE` fails against Supabase's pooler with `database "console" is
being accessed by other users`, and `pg_terminate_backend` does not help: the
pooler holds a backend of its own and just reconnects. Reset the contents
instead, from inside the database:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
```

This also drops `drizzle.__drizzle_migrations`, so `db:migrate` re-applies the
baseline and recreates the ledger with one row. It drops every table too, so
only run it against a database holding nothing worth keeping — the local dev
instance at `localhost:5432/github` is shared with `apps/web`.

> The Supabase dashboard's table editor only reads the `postgres` database, so
> console's twenty-two tables are not visible there. Inspect them over the
> connection string instead.

## Connecting to a managed provider

`src/db/ssl.ts` resolves SSL from the host in `CONSOLE_DATABASE_URL`, the same
way `packages/db` does for `apps/web`:

- **localhost / 127.0.0.0/8** connects in the clear. `docker-compose.yml` uses
  `postgres:17`, which runs with `ssl = off` and refuses the handshake.
- **anything else** connects with `ssl: { rejectUnauthorized: false }`.
  Supabase, Neon and RDS serve their certificate from a private CA that Node
  does not trust, so verifying fails with `SELF_SIGNED_CERT_IN_CHAIN`; the
  connection is still encrypted, it just is not pinned.
- **`CONSOLE_DATABASE_SSL`** overrides the guess. `no-verify` keeps TLS on and
  only skips the certificate check, which is what the default already does;
  `disable` turns TLS off entirely; `require` verifies against the platform
  trust store (add the provider CA through `NODE_EXTRA_CA_CERTS` for that to
  mean anything).

**Do not put `?sslmode=require` in the URL.** `pg` parses the connection string
and lets the result overwrite the `ssl` option, and in `pg-connection-string@2`
`require` is an alias for `verify-full` — the exact verification being avoided.

`drizzle.config.ts` uses the discrete credential form (`host`/`port`/`user`/
`password`/`database`/`ssl`) rather than `url`, because drizzle-kit passes a
`url` and nothing else to `pg.Pool` and drops the `ssl` option beside it.

`db:seed` is idempotent — `seedDefinitions` only inserts definitions that are
missing, so it is safe to re-run and never reverts an edited schedule.
