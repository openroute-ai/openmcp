# @workspace/auth

Shared Better Auth configuration and factory for the monorepo.

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
