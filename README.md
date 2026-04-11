# RoccoBots

An easy way to synchronize posts from 𝕏 (Twitter) to other social media platforms.

## Supported Platforms

| Platform | Notes |
|----------|-------|
| ☁️ [Bluesky](https://bsky.app/) | Full support: posts, threads, media, quotes, replies, profile sync |
| 🦣 [Mastodon](https://joinmastodon.org/) | Full support: posts, threads, media, profile sync |
| Ⓜ️ [Misskey](https://misskey-hub.net/) | Posts with media |
| 🇩 [Discord](https://discord.com/) | Webhook embeds with engagement stats |

---

## Two Modes

RoccoBots has two operating modes. Choose the one that fits your setup.

| | CLI Mode | Web Dashboard Mode |
|--|----------|--------------------|
| **Config** | `.env` file | Browser UI |
| **Multi-bot** | Numeric suffixes in `.env` | Per-bot in the dashboard |
| **Credentials** | Plaintext in `.env` | Encrypted in SQLite |
| **Monitoring** | Terminal logs | Live dashboard with log history |
| **Analytics** | — | Bluesky engagement stats |
| **Entry point** | `bun src/index.ts` | `bun src/web-index.ts` |

---

## Web Dashboard Mode

### Quick Start

**1. Set required environment variables**

```bash
WEB_ADMIN_PASSWORD=your_secure_password
```

An encryption key is auto-generated and saved beside the database on first run. To pin a specific key (required for reproducible deployments / migrations):

```bash
# Generate a key
bun run generate-key

# Then add the output to your environment:
ENCRYPTION_KEY=<64-character hex string>
```

**2. Run**

```bash
bun src/web-index.ts
# → http://localhost:3000
```

**3. Open the dashboard and:**
- Go to **Settings** → configure your Twitter login credentials (shared by all bots)
- Click **Add Bot** → enter the Twitter handle to mirror and set up destination platforms
- Hit **Start** on the bot card

---

### Docker — Web Dashboard

`docker-compose.yml` (pre-built image from GitHub Container Registry):

```yaml
services:
  roccobots-web:
    container_name: "roccobots-web"
    image: ghcr.io/netarcx/roccobots:latest
    restart: unless-stopped
    env_file: ".env.web"
    environment:
      - DATABASE_PATH=/data/data.sqlite
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    command: ["bun", "./src/web-index.ts"]
```

`.env.web`:

```bash
WEB_ADMIN_PASSWORD=your_secure_password

# Optional — pin the encryption key so credentials survive container rebuilds.
# Generate with: bun run generate-key
ENCRYPTION_KEY=your_64_char_hex_key

# Optional
WEB_PORT=3000
DATABASE_PATH=/data/data.sqlite
```

> **Important:** if you don't set `ENCRYPTION_KEY`, a key file is auto-generated at `/data/.encryption.key`. Mount the `/data` volume to persist it across restarts. Without it, all saved platform credentials will be unreadable after a restart.

---

### Web Dashboard Features

#### Dashboard

- Bot cards showing status (running / stopped / error), last sync time, and enabled platforms
- Start / Stop individual bots or all bots at once
- Import bots from an existing `.env` file

#### Adding a Bot

1. Click **Add Bot**
2. Enter the source Twitter handle
3. Set sync frequency (default: 30 minutes)
4. Toggle individual sync options (posts, bio, profile picture, display name, header)
5. Add one or more destination platforms and fill in their credentials
6. Save — credentials are encrypted at rest with AES-256-GCM

#### Settings

- **Twitter Authentication** — one shared Twitter login used by all bots to read tweets
- **Backup & Restore** — export/import all bot configs, platform credentials, and sync state as JSON

> The backup file contains plaintext credentials. Store it securely.

#### Logs

Each bot has a paginated log history (info / warn / error / success entries with timestamps and platform tags). Access from the bot card or via `/bots/:id/logs`.

#### Analytics (Bluesky)

Track engagement on posts that have been synced to Bluesky.

1. Go to **Analytics**, select a bot
2. Click **Refresh from Bluesky** to fetch current like / repost / reply / quote counts
3. Posts are ranked by total engagement

Enable or disable analytics per-bot in the bot's settings under **Sync Options → Bluesky Analytics**.

#### Text Transforms

Per-bot rules that rewrite post text before it is sent to each platform. Available rule types:

| Rule | Effect |
|------|--------|
| `prepend` | Add text before every post |
| `append` | Add text after every post |
| `regex_replace` | Find/replace using a regular expression |
| `strip_urls` | Remove URLs matching a pattern |
| `add_hashtags` | Append hashtags to every post |

Rules can be scoped to specific platforms (e.g., Bluesky only) or applied globally. Configure via the API at `PUT /api/bots/:id/transforms`.

#### Bluesky Commands

Allow trusted Bluesky handles to control a bot by mentioning it with a command:

| Command | Action |
|---------|--------|
| `!sync` | Trigger an immediate sync |
| `!restart` | Restart the bot |
| `!source @handle` | Change the source Twitter account |
| `!status` | Report current bot status |
| `!frequency <min>` | Change sync interval |
| `!posts on/off` | Toggle post syncing |
| `!bio on/off` | Toggle bio syncing |
| `!help` | List available commands |

Enable commands per-bot in the bot edit form under **Bluesky Commands**. Set trusted handles and a poll interval (default: 60 seconds).

---

### Web Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEB_ADMIN_PASSWORD` | ✅ | — | Password for the web dashboard login |
| `ENCRYPTION_KEY` | — | auto-generated | 64-char hex key used to encrypt stored credentials |
| `WEB_PORT` | — | `3000` | HTTP port the server listens on |
| `DATABASE_PATH` | — | `data.sqlite` | Path to the SQLite database file |
| `LOG_RETENTION_DAYS` | — | `30` | How many days of sync logs to keep |

---

## CLI Mode

### Docker — CLI

`docker-compose.cli.yml` (pre-built image):

```yaml
services:
  roccobots:
    container_name: "roccobots"
    image: ghcr.io/netarcx/roccobots:latest
    restart: unless-stopped
    env_file: ".env"
    environment:
      - DATABASE_PATH=/data/data.sqlite
    volumes:
      - ./data:/data
```

Run with:
```bash
docker compose -f docker-compose.cli.yml up -d
```

---

### Environment Variables `(.env)`

#### Single Account

```bash
# --- 𝕏 (Twitter) ---
TWITTER_HANDLE=YourXHandle
TWITTER_USERNAME=your_x_email@example.com
TWITTER_PASSWORD=YourXPassword

# --- ☁️ Bluesky (optional) ---
BLUESKY_INSTANCE=bsky.social          # default: bsky.social
BLUESKY_IDENTIFIER=your-handle.bsky.social
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx  # use an app password

# --- 🦣 Mastodon (optional) ---
MASTODON_INSTANCE=https://mastodon.social
MASTODON_ACCESS_TOKEN=YourMastodonAccessToken

# --- Ⓜ️ Misskey (optional) ---
MISSKEY_INSTANCE=https://misskey.io
MISSKEY_ACCESS_CODE=YourMisskeyApiToken

# --- 🇩 Discord Webhook (optional) ---
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1234567890/abcde
```

#### Multi-Account

Each account uses a numeric suffix. The first account has no suffix, the second uses `1`, the third uses `2`, and so on. Each account can target different platforms.

```bash
# ======= ACCOUNT 0 (no suffix) =======
TWITTER_HANDLE=FirstXHandle
BLUESKY_IDENTIFIER=first-handle.bsky.social
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/111111111/xxxxxxxxxx

# ======= ACCOUNT 1 =======
TWITTER_HANDLE1=SecondXHandle
MASTODON_ACCESS_TOKEN1=yyyyyyyyyyyyyyyyyy   # defaults to mastodon.social

# ======= ACCOUNT 2 =======
TWITTER_HANDLE2=ThirdXHandle
MISSKEY_INSTANCE2=https://misskey.io
MISSKEY_ACCESS_CODE2=zzzzzzzzzzzzzzzzzzzzzz
```

#### Optional CLI Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SYNC_FREQUENCY_MIN` | `30` | Minutes between sync cycles |
| `DAEMON` | `true` | Keep running on a loop; `false` = run once and exit |
| `SYNC_POSTS` | `true` | Sync posts |
| `SYNC_PROFILE_DESCRIPTION` | `true` | Sync bio |
| `SYNC_PROFILE_PICTURE` | `true` | Sync profile picture |
| `SYNC_PROFILE_NAME` | `true` | Sync display name |
| `SYNC_PROFILE_HEADER` | `true` | Sync header image |
| `BACKDATE_BLUESKY_POSTS` | `true` | Use original tweet timestamp on Bluesky |
| `DATABASE_PATH` | `data.sqlite` | Path to the SQLite database |
| `FORCE_SYNC_POSTS` | `false` | Re-sync already-synced posts |

---

## Building from Source

```bash
# Install Bun: https://bun.sh
bun install

# CLI mode
bun src/index.ts

# Web dashboard mode
bun src/web-index.ts
```

---

## Contact

Bluesky: [@beastModeRocco.com](https://bsky.app/profile/beastModeRocco.com)
