# @workspace/typescript-config

Shared TypeScript configuration presets for the monorepo.

## Presets

| File | Use in |
| --- | --- |
| `base.json` | Base config extended by all others |
| `node.json` | Node.js apps and packages (API, db, auth) |
| `nextjs.json` | Next.js applications |
| `react-library.json` | React component libraries (ui) |

## Usage

```json
{
  "extends": "@workspace/typescript-config/node.json",
  "include": ["src"],
  "exclude": ["node_modules"]
}
```
