# @workspace/eslint-config

Shared ESLint 9 flat config presets for the monorepo.

## Presets

| Export | Use in |
| --- | --- |
| `@workspace/eslint-config/base` | Any TypeScript package |
| `@workspace/eslint-config/node` | Node.js apps/packages |
| `@workspace/eslint-config/next-js` | Next.js applications |
| `@workspace/eslint-config/react-internal` | React library packages |

## Usage

```js
// eslint.config.js
import config from "@workspace/eslint-config/node"

export default [...config]
```

## Includes

- `@typescript-eslint` (parser + plugin)
- `eslint-config-prettier` (disables formatting rules)
- `eslint-plugin-turbo` (Turborepo lint rules)
- `eslint-plugin-react` + `react-hooks` (for React presets)
- `@next/eslint-plugin-next` (for Next.js preset)
- `eslint-plugin-only-warn` (treats all rules as warnings)
