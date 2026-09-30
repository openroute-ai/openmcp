# Dashboard

Next.js 16 application serving the main user-facing dashboard.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [React 19](https://react.dev)
- [@workspace/ui](../../packages/ui) (shared component library)
- [Tabler Icons](https://tabler.io/icons)
- [next-themes](https://github.com/pacocoursey/next-themes) (dark mode)

## Development

```bash
pnpm --filter dashboard dev
```

Starts on `http://localhost:20001` in development (`dev` passes `--port 20001`,
`start` binds `PORT`), so it does not collide with `apps/console` on 20002.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start dev server with Turbopack |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript check |
