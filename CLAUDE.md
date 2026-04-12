# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RoccoBots is a TypeScript application that synchronizes posts from X (Twitter) to Bluesky, Mastodon, Misskey, and Discord (webhooks). It runs on Bun and has two operating modes: CLI daemon and web dashboard.

## Commands

```bash
# Run CLI daemon mode (reads .env for config)
bun src/index.ts

# Run web dashboard mode (requires WEB_ADMIN_PASSWORD and ENCRYPTION_KEY env vars)
bun src/web-index.ts

# Lint
bun run lint
bun run lint:fix

# Generate encryption key for web mode
bun run generate-key

# Database migrations (Drizzle)
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

There is no test suite in this project.

## Architecture

### Dual-Mode Operation

- **CLI mode** (`src/index.ts`): Reads Twitter handles and platform credentials from `.env` file (multi-account via numeric suffixes like `TWITTER_HANDLE1`, `TWITTER_HANDLE2`). Runs a daemon loop syncing at a configurable interval (default 30 min).
- **Web mode** (`src/web-index.ts`): Hono web server on port 3000. Bot configs stored in SQLite with encrypted credentials (AES-256-GCM). REST API + SSE for real-time logs.

### Synchronizer Pattern

Each platform implements `SynchronizerFactory<KEYS, SCHEMA>` (defined in `src/sync/synchronizer.ts`). Factories are in `src/sync/platforms/`:
- `bluesky/` — `@atproto/api`
- `mastodon/` — `masto` library
- `misskey/` — `misskey-js`
- `discord-webhook/` — Discord webhook API

Each synchronizer can implement: `syncBio`, `syncUserName`, `syncProfilePic`, `syncBanner`, `syncPost`. The factory pattern provides `ENV_KEYS`, `FALLBACK_ENV`, `PLATFORM_ID`, and a `STORE_SCHEMA` (Zod) for per-platform persistent state.

### Key Modules

- `src/env.ts` — Parses all environment variables; multi-account handle discovery loop
- `src/sync/x-client.ts` — Twitter scraper client with CycleTLS for Cloudflare bypass
- `src/sync/sync-posts.ts` / `sync-profile.ts` — Core sync orchestration
- `src/sync/bot-instance.ts` — Single bot abstraction (used by web mode's BotManager)
- `src/db/` — Drizzle ORM with Bun's native SQLite; schemas in `db/schema/v1.ts` (legacy) and `db/schema/v2.ts` (web tables)
- `src/web/` — Hono app: routes in `web/routes/api/`, services in `web/services/` (BotManager, ConfigService, EncryptionService)
- `src/utils/tweet/` — Text formatting, splitting long posts, media downloading
- `src/utils/medias/` — Image compression (sharp, lazy-loaded), hashing
- `src/utils/url/` — Shortened URL resolution/replacement

### Database

SQLite via Drizzle ORM. The v1 schema stores synced post metadata (avoiding duplicates). The v2 schema (web mode) adds: `bot_configs`, `platform_configs` (encrypted JSON credentials), `sync_logs`, `bot_status`, `web_sessions`.

Post-v2 additions (applied via in-code `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` in `src/db/migration.ts`, not via drizzle-kit):
- `twitter_auth` — single-row global Twitter credentials shared by all bots
- `command_configs` — per-bot Bluesky command handler settings
- `tweet_metrics` — Bluesky engagement stats (likes, reposts, replies, quotes) per synced post
- `bot_configs.analytics_enabled` — boolean column to enable/disable analytics per bot
- `bot_configs.transform_rules` — JSON column for per-bot text transform rules

**Migration pattern**: New tables and columns added after the initial v2 deployment use idempotent try/catch `ALTER TABLE` or `CREATE TABLE IF NOT EXISTS` statements at the bottom of `migrate()` in `src/db/migration.ts`. Do NOT use drizzle-kit for these incremental additions.

### Web Dashboard Features

- **Analytics** (`src/web/routes/api/analytics.ts`, `src/web/views/analytics.ts`): Tracks Bluesky engagement (likes/reposts/replies/quotes) per synced post. `GET /api/analytics/:botId?range=day|week|month` filters by `recordedAt`. `GET /api/analytics/combined` aggregates across all bots. `POST /api/analytics/:botId/refresh` fetches live stats via `agent.app.bsky.feed.getPosts`.
- **Text Transforms** (`src/sync/transforms/`): Per-bot rules (prepend, append, regex_replace, strip_urls, add_hashtags) applied before posting. Scoped to specific platforms or global.
- **Bluesky Commands** (`src/sync/commands/`): Trusted Bluesky handles can control a bot via mentions (`!sync`, `!restart`, `!source`, `!status`, `!frequency`, `!posts`, `!bio`, `!help`). Polled at a configurable interval.

### TypeScript Path Aliases

`tsconfig.json` sets `baseUrl: "./src"`, so imports use bare paths like `import { db } from "db"` rather than relative paths.

## Code Style

- Bun runtime, ESM modules (`"type": "module"`)
- Strict TypeScript (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- Prettier: 2-space indentation, semicolons, double quotes (no `.prettierrc` — this is the Prettier default)
- ESLint: `simple-import-sort` plugin enforces import ordering; unused parameters must be prefixed with `_`
- Conventional commits (commitlint configured)
