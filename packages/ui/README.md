# @workspace/ui

Shared component library built with shadcn/ui, Radix UI, and Tailwind CSS v4.

## Stack

- [shadcn/ui](https://ui.shadcn.com) (component scaffolding)
- [Radix UI](https://www.radix-ui.com) (accessible primitives)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Recharts](https://recharts.org) (charts)
- [cmdk](https://cmdk.paco.me) (command palette)
- [Vaul](https://vaul.emilkowal.ski) (drawer)
- [Sonner](https://sonner.emilkowal.ski) (toasts)

## Components

55 components available, including buttons, dialogs, forms, tables, charts, and more.

## Exports

| Export | Path | Description |
| --- | --- | --- |
| `./components/*` | `src/components/*.tsx` | Individual UI components |
| `./lib/*` | `src/lib/*.ts` | Utilities (`utils.ts` with `cn()`) |
| `./hooks/*` | `src/hooks/*.ts` | React hooks (`use-mobile.ts`) |
| `./globals.css` | `src/styles/globals.css` | Global stylesheet |
| `./postcss.config` | `postcss.config.mjs` | Shared PostCSS config |

## Adding components

```bash
# from the monorepo root
pnpm --filter @workspace/ui dlx shadcn@latest add <component-name>
```

## Usage in apps

```tsx
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
