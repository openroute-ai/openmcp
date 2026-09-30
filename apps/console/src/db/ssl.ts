import type { PoolConfig } from "pg"

/**
 * The SSL decision lives here rather than in the pool options because `pg`
 * parses the connection string and lets the result overwrite them: an
 * `sslmode` in the URL wins over the `ssl` object passed to `Pool`. Managed
 * providers hand out `?sslmode=require` URLs, and `pg-connection-string@2`
 * treats `require` as an alias for `verify-full` — the very verification that
 * fails against a private CA. Keep `sslmode` out of `CONSOLE_DATABASE_URL`.
 */

/** Host of `user:pass@host:5432/db`, or `undefined` for a DSN without one. */
function extractHost(connectionString: string): string | undefined {
  return connectionString.match(/@(\[[^\]]*\]|[^:/@?#]+)/)?.[1]
}

function isLocalhost(host: string | undefined): boolean {
  if (!host) return false

  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.")
  )
}

/**
 * Local databases connect in the clear: the `postgres:17` image in
 * `docker-compose.yml` runs with `ssl = off` and refuses the handshake.
 * Everything else gets an encrypted connection without a certificate check,
 * because the provider's CA is not in Node's trust store and the app ships no
 * bundle to pin. `CONSOLE_DATABASE_SSL` overrides the guess, and
 * `CONSOLE_DATABASE_SSL=require` is the one that verifies, for deployments
 * that add the provider CA through `NODE_EXTRA_CA_CERTS`.
 */
export function resolveSsl(
  connectionString: string | undefined,
  mode = process.env.CONSOLE_DATABASE_SSL
): PoolConfig["ssl"] {
  const normalized = (mode ?? "").trim().toLowerCase()

  if (
    ["require", "required", "verify", "true", "1", "yes"].includes(normalized)
  ) {
    return { rejectUnauthorized: true }
  }
  if (
    ["allow", "prefer", "no-verify", "noverify", "verify-none"].includes(
      normalized
    )
  ) {
    return { rejectUnauthorized: false }
  }
  if (["disable", "false", "0", "no", "none"].includes(normalized)) return false

  if (!connectionString) return false
  return isLocalhost(extractHost(connectionString))
    ? false
    : { rejectUnauthorized: false }
}

/**
 * Splits the URL into the discrete credentials drizzle-kit needs. It passes
 * nothing but `url` to `pg.Pool` when `dbCredentials.url` is set, so the
 * resolved SSL options would be dropped on the way to the driver.
 */
export function toDiscreteCredentials(connectionString: string) {
  const url = new URL(connectionString)
  const port = Number(url.port)

  return {
    host: url.hostname,
    ...(Number.isFinite(port) && port > 0 ? { port } : {}),
    ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl: resolveSsl(connectionString),
  }
}
