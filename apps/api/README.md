# API

Hono-based REST API with Better Auth authentication and Drizzle ORM.

## Stack

- [Hono](https://hono.dev) + [@hono/node-server](https://github.com/honojs/node-server)
- [Better Auth](https://www.better-auth.com) (email/password)
- [Drizzle ORM](https://orm.drizzle.team) with node-postgres

## Prerequisites

- Docker (for Postgres) or a running PostgreSQL instance
- A `.env` file at the monorepo root (see `.env.example`)

```bash
# start the database
docker compose up -d

# run migrations
pnpm --filter @workspace/db db:migrate
```

## Development

```bash
pnpm --filter api dev
```

The server starts on `http://localhost:8080` by default (override with `PORT`).

## Available routes

| Method | Path | Description |
| --- | --- | --- |
| `GET/POST` | `/api/auth/*` | Better Auth endpoints |
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/hello` | Hello world |
| `ALL` | `/api/v1/mcp/store/*` | Store MCP proxy (requires `OPENMCP_WEB_BASE_URL`) |

## Store MCP

Marketplace Store MCP (`search_assets` / `get_asset` / `install_asset`) is implemented in **apps/web** at `/api/mcp/store` so it can share `packages/db` and skill acquire/entitlement logic.

This API process exposes a thin proxy at `/api/v1/mcp/store` when `OPENMCP_WEB_BASE_URL` is set (e.g. `https://www.openmcp.cn` or `http://localhost:20001`). Without it, the route returns `501` with registration hints.

Preferred agent registration (Cursor `mcp.json`):

```json
{
  "mcpServers": {
    "openmcp-store": {
      "url": "https://www.openmcp.cn/api/mcp/store",
      "headers": {
        "Authorization": "Bearer YOUR_OPENMCP_API_KEY"
      }
    }
  }
}
```

Device Code (optional): `POST {WEB}/api/mcp/store/oauth/device` → user visits `/device` → poll `.../oauth/token`.

See `docs/design/AGENT_INSTALL.md`.

## Testing with HTTPie

```bash
# health check
http :8080/api/v1/health

# hello
http :8080/api/v1/hello

# sign up
http POST :8080/api/auth/sign-up/email \
  name="Test User" \
  email="test@example.com" \
  password="password123"

# sign in
http POST :8080/api/auth/sign-in/email \
  email="test@example.com" \
  password="password123"
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start dev server with hot reload (tsx watch) |
| `pnpm build` | Bundle with tsdown |
| `pnpm start` | Run production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
