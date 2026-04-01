# Doc

Documentation site built with Fumadocs and Next.js 16.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [Fumadocs](https://fumadocs.vercel.app) (MDX docs framework)
- [AI SDK](https://sdk.vercel.ai) + Mistral (AI-powered search/features)
- [@workspace/ui](../../packages/ui) (shared component library)

## Development

```bash
pnpm --filter doc dev
```

Starts on `http://localhost:6969`.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start dev server (port 6969, Turbopack) |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build (port 6969) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate Fumadocs types, then run tsc |
