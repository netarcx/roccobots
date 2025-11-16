# RoccoBots
## A Fork of the Touitomamout-NEXT


An easy way to synchronize your posts on 𝕏 to other social media platforms.

## What's different about this Fork?

- Fixes the awful name the orginal developer gave the project 
- Updated to work with new Twitter endpoints
- Bypasses Cloudflare

## Supported platforms

- 🦣 [Mastodon](https://joinmastodon.org/)
- ☁️ [Bluesky](https://bsky.app/)
- Ⓜ️ [Misskey](https://misskey-hub.net/)
- 🇩 [Discord](https://discord.com/) (Webhook)

## Get started

### File Structure

Your directory should look like this before running the application:

```txt
touitomamout/
├── docker-compose.yml
├── .env
└── data/
    └── next/
```

### Docker Compose Setup

```yml
version: '3.9'

services:
  roccobots:
    container_name: "roccobots"
    build:
      context: ./  # ← This will build the image from the source code
    restart: unless-stopped
    environment:
      - ENV_FILE=/data/.env
      - STORAGE_DIR=/data
    volumes:
      - ./data:/data

```

### Environment Variables `(.env)`

#### Single Account Setup

For a single user, define the variables without any numeric suffix. You only need to add variables for the platforms you want to sync to.

```bash
#--- 𝕏 (Twitter) Account Credentials (Required Handle, Optional Login) ---#
TWITTER_HANDLE=YourXHandle
# USERNAME and PASSWORD are not required but are recommended for a more stable session.
TWITTER_USERNAME=your_x_username
TWITTER_PASSWORD=YourXPassword

#--- ☁️ Bluesky Credentials (Optional) ---#
# If not set, BLUESKY_INSTANCE defaults to "bsky.social".
BLUESKY_INSTANCE=bsky.social
BLUESKY_IDENTIFIER=your-handle.bsky.social
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx # Use an app password, not your main password

#--- 🦣 Mastodon Credentials (Optional) ---#
# If not set, MASTODON_INSTANCE defaults to "mastodon.social".
MASTODON_INSTANCE=https://mastodon.social
MASTODON_ACCESS_TOKEN=YourMastodonAccessToken

#--- Ⓜ️ Misskey Credentials (Optional) ---#
MISSKEY_INSTANCE=https://your-instance.net # e.g., misskey.io
MISSKEY_ACCESS_CODE=YourMisskeyApiToken # Generate this in Settings > API

#--- 🇩 Discord Webhook (Optional) ---#
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1234567890/abcde-fghij
```

#### Multi-Account Setup

This fork's key feature is multi-account support.

- The first account uses variables with no number suffix.
- The second account uses variables with the suffix 1.
- The third account uses variables with the suffix 2, and so on.

You can mix and match which platforms each account posts to.

`.env` example for three accounts:

```bash
# ==================================
# ======= FIRST ACCOUNT (0) ========
# ==================================
TWITTER_HANDLE=FirstXHandle
# This account will post to Bluesky and Discord
BLUESKY_IDENTIFIER=first-handle.bsky.social
BLUESKY_PASSWORD=xxxx-xxxx-xxxx-xxxx
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/111111111/xxxxxxxxxx

# ==================================
# ======= SECOND ACCOUNT (1) =======
# ==================================
TWITTER_HANDLE1=SecondXHandle
# This account will post to Mastodon (using the default instance: mastodon.social)
MASTODON_ACCESS_TOKEN1=yyyyyyyyyyyyyyyyyy

# ==================================
# ======= THIRD ACCOUNT (2) ========
# ==================================
TWITTER_HANDLE2=ThirdXHandle
# This account will post to Misskey
MISSKEY_INSTANCE2=https://misskey.io
MISSKEY_ACCESS_CODE2=zzzzzzzzzzzzzzzzzzzzzz



```

### Questions

contact me on bluesky @beastModeRocco.com