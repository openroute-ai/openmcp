# @workspace/db

Drizzle ORM schema and migration package for PostgreSQL.

## Stack

- [Drizzle ORM](https://orm.drizzle.team) (runtime)
- [Drizzle Kit](https://orm.drizzle.team/docs/drizzle-kit) (migrations CLI)

## Prerequisites

A `.env` file at the monorepo root with:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/studio
```

## Exports

| Export | Path | Description |
| --- | --- | --- |
| `.` | `src/index.ts` | All schema tables, relations, and the `schema` object |
| `./schema` | `src/schema.ts` | Schema-only (for direct imports) |

## Schema

Currently contains the Better Auth tables (generated via `@workspace/auth`):

- `user` - User accounts
- `session` - Active sessions
- `account` - OAuth/credential provider links
- `verification` - Email verification tokens

## Scripts

```bash
# generate a migration after schema changes
pnpm --filter @workspace/db db:generate

# apply pending migrations
pnpm --filter @workspace/db db:migrate

# push schema directly (dev only, no migration file)
pnpm --filter @workspace/db db:push

# validate migration consistency
pnpm --filter @workspace/db db:check

# open Drizzle Studio (GUI)
pnpm --filter @workspace/db db:studio
```
