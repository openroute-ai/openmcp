# @workspace/auth

Shared Better Auth configuration and factory for the monorepo.

## Who uses this

`apps/web` and `apps/api`. Both share one database (`DATABASE_URL`), so one
auth configuration is genuinely shared.

`apps/console` deliberately does **not**. It has its own database
(`CONSOLE_DATABASE_URL`), its own `user` table, and its own rate limiter, and
builds its Better Auth instance directly in `src/lib/auth.ts`. Routing it
through this package was what produced the `Endpoint path conflicts detected`
error: `createAuth` concatenated the shared plugin list with the app's, and both
declared `phoneNumber()`, so the same five endpoints registered twice. A
console-side plugin change should not be able to collide with a shared default,
and the two apps do not share a login surface to keep consistent.

The two libraries are still on the same Better Auth version, so a schema change
in `packages/db/src/auth-schema.ts` needs applying to console's `user` table
separately — that is the cost of the split, and it is deliberate.

## Stack

- [Better Auth](https://www.better-auth.com) with Drizzle adapter

## Exports

| Export                                      | Description                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `createAuth(db, options)`                   | Factory that creates a Better Auth instance bound to a Drizzle database            |
| `createRedisRateLimitStorage(redis, opts?)` | Redis-backed storage handing Better Auth's rate limiter (`auth:rate-limit:*` keys) |
| `RateLimitStorage`                          | The `customStorage` contract (`consume(key, rule)`)                                |

## Usage

```ts
import {
  createAuth,
  createRedisRateLimitStorage,
  AUTH_PATH,
} from "@workspace/auth"
import Redis from "ioredis"

const redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true })
const auth = createAuth(db, {
  baseURL: "http://localhost:8080",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: ["http://localhost:3000"],
  rateLimit: {
    window: 60, // default per-IP bucket, seconds
    max: 100,
    storage: createRedisRateLimitStorage(redis, { prefix: "my-app:" }),
  },
})

// Mount in Hono
app.on(["GET", "POST"], `${AUTH_PATH}/*`, (c) => auth.handler(c.req.raw))
```

### Redis rate limiting

Better Auth ships an in-memory rate limiter that only throttles the process
that holds it and resets on restart. Passing `rateLimit.storage` built from
`createRedisRateLimitStorage` moves the counters to Redis so limits hold
across replicas and survive restarts.

Rules that apply once enabled:

- Strict built-ins: `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*`
  are capped at **3 requests / 10 s** per IP; password-reset and verification
  paths at **3 / 60 s**.
- Everything else under the auth route uses the configurable `window`/`max`
  default (above) per IP.
- Keys are `<ip>|<path>`; IP comes from `x-forwarded-for` (override via
  `advanced.ipAddress.ipAddressHeaders`). If no IP can be trusted, better-auth
  falls back to a single shared per-path bucket.
- Fixed-window counters, incremented atomically in a Lua script, so concurrent
  requests cannot race past the limit.
- On a Redis outage the limiter **fails open** (requests allowed) and logs a
  single warning per process, so logins continue to work.

The option is opt-in: apps that don't pass `rateLimit` keep exactly the
previous behaviour.

## Generating the auth schema

The auth schema for Drizzle lives in `packages/db/src/auth-schema.ts`. To regenerate it after changing auth options or plugins:

```bash
pnpm --filter @workspace/auth auth:generate
```

This runs the Better Auth CLI with `src/generate.ts` as config and outputs the Drizzle schema to `../db/src/auth-schema.ts`.

## Scripts

| Script               | Description                        |
| -------------------- | ---------------------------------- |
| `pnpm auth:generate` | Regenerate the Drizzle auth schema |
| `pnpm lint`          | ESLint                             |
| `pnpm typecheck`     | TypeScript check                   |
