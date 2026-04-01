import globals from "globals"
import { config as baseConfig } from "./base.js"

/**
 * A shared ESLint configuration for Node.js apps (no React/Next.js).
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
]
