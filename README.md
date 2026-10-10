# Yourrest CRM

Customer relationship management for Yourrest Industries, served at https://crm.yourrest.org.
Next.js 16 on `vinext`, React 19, TypeScript (strict), SQLite through a D1-style adapter, email one-time-code
sign-in, Arabic-first RTL interface with English, offline entry for field staff and a PWA/Android shell.

Requirements: Node.js >= 22.16 and pnpm 11 (`corepack enable`). The app uses the built-in `node:sqlite`; there is no
external database server.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install the locked dependencies |
| `pnpm typecheck` | TypeScript, strict, no emit |
| `pnpm lint` | ESLint (generated output is ignored) |
| `pnpm check` | Typecheck plus every default test (about 6 minutes, isolated temporary data) |
| `pnpm build` | Production build into `dist/standalone` |
| `pnpm demo` | Run the built release locally with synthetic accounts (see the Arabic guide) |
| `pnpm start` | Start the built release; needs real settings (see `settings.example.cjs`) |

Extra gates that need a build or a browser are listed in `tests/CHECKS.md`
(`node tests/server-authorization.mjs`, `node tests/sales-date-boundaries.mjs`, `node tests/namecheap-http.mjs` after `pnpm build`;
Playwright browser tests with `YR_BROWSER_EXECUTABLE` and `CODEX_PRIMARY_RUNTIME_NODE_MODULES`).

## Layout

- `app/` pages, client components and `app/api/*` route handlers
- `lib/` domain rules and server logic (access control, targets, KPI weights, sales, ERP import, offline sync)
- `db/`, `drizzle/` schema and append-only SQL migrations (never edit an applied migration)
- `portable/` hosting layer: launcher, setup, backup, restore, upgrade (Passenger/cPanel, private data folders)
- `scripts/` build, packaging, demo and release helpers; `scripts/lib/built-app.mjs` boots the built release for tests
- `tests/` regression, security, browser and release suites
- `mobile/android` native Android source (not built here)
- `docs/` Arabic operating guides, per-release notes and verification evidence

## Operating, developing and updating

- Arabic guide: `docs/OPERATIONS-DEVELOPMENT-GUIDE-AR.md`
- Release history: `docs/CHANGELOG-HISTORY.md`
- Backups and restore: `docs/PRODUCTION-BACKUP-AR.md`
- Hosting notes for Namecheap: `docs/NAMECHEAP-AR.md`
- Test, fix and refactor report for this revision: `docs/qa/REPORT-AR.md`

Configuration is read from a private `settings.cjs` kept outside the release (template: `settings.example.cjs`,
environment template: `.env.example`). No credentials, database or signing key are part of this repository.
