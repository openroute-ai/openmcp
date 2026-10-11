<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Never run destructive database operations against `CONSOLE_DATABASE_URL`

`CONSOLE_DATABASE_URL` (`apps/console`) is the **application's real database** —
in a deployment, production. It holds the project catalogue, repositories, the
hall of fame and the curator's categories.

The console integration suites (`apps/console/src/test/*.integration.test.ts`)
clean up by **deleting whole tables with no `WHERE` clause** (`await
db.delete(projects)`, `db.delete(repos)`, `db.delete(tags)`, ...). Running them
is therefore a destructive operation. Pointing them at `CONSOLE_DATABASE_URL`
has already happened once and wiped real data.

Rules:

- **Do not run any test that deletes rows against `CONSOLE_DATABASE_URL`.** No
  exceptions, no "just to see it pass".
- Integration suites only get a database when `CONSOLE_TEST_DATABASE_URL` is
  set. That variable is the explicit, per-run opt-in and must name a
  throwaway/test database. It is enforced in
  `apps/console/src/test/setup-env.ts`: without it the suites skip, and if it
  equals `CONSOLE_DATABASE_URL` the run aborts.
- **Do not add unconditional `DELETE`/`TRUNCATE` (no `WHERE`) on
  `CONSOLE_DATABASE_URL`** to any script, test, migration, seed or task unless
  the user explicitly asks for it. When a cleanup is genuinely required, scope
  it (a `WHERE` on the fixture's own ids/owner) so it cannot touch rows it did
  not create.
- If an integration suite is skipping and you think it should run, set
  `CONSOLE_TEST_DATABASE_URL` — never repoint `CONSOLE_DATABASE_URL` at it.

