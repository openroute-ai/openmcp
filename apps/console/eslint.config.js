import { nextJsConfig } from "@workspace/eslint-config/next-js"

/**
 * Console is deployed on its own, against its own database
 * (`CONSOLE_DATABASE_URL`). `@workspace/db` and `@workspace/auth` are web/api's
 * and neither is declared in `package.json` any more.
 *
 * It has already happened once: `src/db/schema.ts` re-exported all of
 * `@workspace/db/schema` (86 tables) and `next.config.mjs` transpiled
 * `@workspace/db` into console's build. Nothing broke at runtime, which is why
 * it survived — the failure was silent and appeared only in the *migration*,
 * where `drizzle-kit generate` tried to `CREATE TABLE` every web table inside
 * console's database.
 *
 * `@workspace/ui` and `@workspace/sms-captcha` are deliberately allowed: shared
 * components are the intended L1 layer. `@workspace/db` would give a shared
 * *schema* to an app whose entire premise is not sharing its data.
 *
 * This rule is the *explanation*, not the enforcement. The enforcement is that
 * neither package is in `package.json` and neither is in `tsconfig.json` paths
 * any more, so an import of either fails `pnpm typecheck` with TS2307 before
 * this message is ever read. (ESLint 9.39 resolves this rule at severity
 * `error` per `--print-config` but still reports it as a warning, and console's
 * `lint` script has no `--max-warnings 0` — which is exactly why the tsc side
 * is the one that has to hold.)
 *
 * @type {import("eslint").Linter.Config}
 */
const noSharedSchema = {
  name: "console/no-shared-db-schema",
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@workspace/db", "@workspace/db/*", "@workspace/auth", "@workspace/auth/*"],
            message:
              "Console has its own database (CONSOLE_DATABASE_URL) and must not depend on web/api's schema. Declare console's tables in src/db/schema.ts. See docs/design/CONSOLE_RADAR_COMMERCIAL_PLAN.md decision #7.",
          },
        ],
      },
    ],
  },
}

export default [...nextJsConfig, noSharedSchema]
