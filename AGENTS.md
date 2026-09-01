# Repository Engineering Instructions

## Project

This is a production-quality two-player Gin Rummy web application.

## Technology

- Next.js 16.3.3
- App Router
- TypeScript strict mode
- Tailwind CSS
- Supabase/Postgres
- Supabase Auth
- Supabase Realtime
- Vitest
- Playwright
- Vercel

## Authoritative Documents

- Product: `docs/PRODUCT.md`
- Game rules: `docs/GAME_ENGINE.md`
- UX: `docs/UX.md`
- Architecture: `docs/ARCHITECTURE.md`
- Visual reference: `docs/assets/art-direction.png`

## Engineering Rules

1. The server is authoritative.
2. Clients submit actions, never trusted resulting game state.
3. Never expose opponent hidden cards or future stock cards.
4. Gin Rummy rules live in a pure TypeScript game engine.
5. The game engine must have no React, Next.js, database, or Supabase dependencies.
6. All game actions must be validated server-side.
7. Persisted game state must use optimistic concurrency/version checking.
8. Refresh and reconnect must recover the current game.
9. Realtime is notification/synchronization, not canonical state.
10. PostgreSQL is canonical.
11. Avoid unnecessary abstractions and dependencies.
12. Do not modify unrelated code while completing scoped tasks.

## Visual Direction

Inspect `docs/assets/art-direction.png` when doing game UI work.

Preserve:

- Dark green felt
- Warm dark wood
- Restrained gold
- Cream cards
- Premium physical card-table feeling
- Elegant serif branding
- Highly readable cards
- Player hand as the visual focus

Avoid:

- Casino aesthetics
- Cartoon aesthetics
- Generic SaaS dashboards
- Unnecessary visual clutter

## Workflow

For scoped changes:

- Inspect only relevant files first.
- Run targeted tests.
- Do not run the entire E2E suite unnecessarily.

At major checkpoints, run:

- `npm test`
- `npm run lint`
- `npm run build`

Never claim something works without testing it.

Keep task summaries concise.
