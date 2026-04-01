# @workspace/auth

Shared Better Auth configuration and factory for the monorepo.

## Stack

- [Better Auth](https://www.better-auth.com) with Drizzle adapter

## Exports

| Export | Description |
| --- | --- |
| `createAuth(db, options)` | Factory that creates a Better Auth instance bound to a Drizzle database |
| `AUTH_PATH` | The auth route prefix (`/api/auth`) |
| `sharedAuthOptions` | Shared config (email/password enabled) |

## Usage

```ts
import { createAuth, AUTH_PATH } from "@workspace/auth"

const auth = createAuth(db, {
  baseURL: "http://localhost:8080",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ["http://localhost:3000"],
})

// Mount in Hono
app.on(["GET", "POST"], `${AUTH_PATH}/*`, (c) => auth.handler(c.req.raw))
```

## Generating the auth schema

The auth schema for Drizzle lives in `packages/db/src/auth-schema.ts`. To regenerate it after changing auth options or plugins:

```bash
pnpm --filter @workspace/auth auth:generate
```

This runs the Better Auth CLI with `src/generate.ts` as config and outputs the Drizzle schema to `../db/src/auth-schema.ts`.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm auth:generate` | Regenerate the Drizzle auth schema |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
