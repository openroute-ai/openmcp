import { loadConsoleEnv } from "@/db/load-env"

// Vitest runs this before any test module is evaluated, which is what makes
// `@/db/client` safe to import statically: its pool is built at module scope,
// and ES import hoisting would run a top-level `loadConsoleEnv()` in the test
// file itself *after* that body. Vite only forwards `VITE_`-prefixed vars to
// `process.env`, so without this every integration suite would see
// `CONSOLE_DATABASE_URL` unset and skip instead of fail.
loadConsoleEnv()
